"use strict";
/* ALPHA-O Automate platform app (client workspace).
 * Talks only to the existing ALPHA-O Worker (/api/automation/*). Never holds provider keys.
 * Untrusted text is always inserted with textContent (no innerHTML with data). */
(() => {
  const C = window.AlphaOCore;
  if (!C) { console.error("Alpha-O Platform: alphao-core.js did not load."); return; }
  const API = "https://alpha-o-api.ituzerichard6.workers.dev";
  const TOKEN_KEY = "alphaO.platform.token.v1", TOUR_KEY = "alphaO.platform.tour.v1";

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v; else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, ""); else el.setAttribute(k, v);
    }
    kids.flat(2).forEach(c => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const S = { token: "", me: null, view: "overview", unread: 0, wfFilter: { q: "", status: "" }, exFilter: "all", exTests: false, exSel: null };
  const App = (window.AlphaOApp = { S, h, $, views: {}, C });

  /* ---------- formatting ---------- */
  const fmtDate = ms => (ms ? new Date(ms).toLocaleString() : "—");
  const fmtDur = ms => (!Number.isFinite(ms) ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  function ago(ms) { if (!ms) return "never"; const s = Math.max(0, (Date.now() - ms) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; }
  const STATUS_CLASS = { Completed: "success", Failed: "failed", Cancelled: "skipped", Running: "running", Queued: "running", Pending: "running", Retrying: "unsupported", active: "success", draft: "neutral", paused: "unsupported", archived: "skipped" };
  const STATUS_TEXT = { Completed: "Successful" };
  const pill = st => h("span", { class: "status-pill status-" + (STATUS_CLASS[st] || "neutral") }, STATUS_TEXT[st] || String(st || "unknown").replace(/^./, c => c.toUpperCase()));
  const can = p => Boolean(S.me && S.me.permissions && S.me.permissions.includes(p));
  const ERROR_HELP = {
    CONDITION_ERROR: "A condition could not be checked. Usually a field it needs is missing from the input data.", DB_ERROR: "A temporary storage problem interrupted this step. It is safe to retry.",
    INTEGRATION_DISABLED: "This step needs an external service that is not connected yet. Remove it or replace it with an internal step.", STEP_LIMIT: "The workflow ran more steps than one run allows (25).",
    MISSING_INPUT: "A step needed data that was not provided.", INVALID_COMPARISON: "A condition compared values of the wrong kind (for example text against a number).",
    INVALID_VALUE: "A step received a value it could not use.", VARIABLE_LIMIT: "Too many values were created in one run.", ENGINE_ERROR: "The engine stopped unexpectedly. Try again; if it repeats, tell your administrator.", STOPPED: "The workflow reached a Stop step set to fail."
  };

  /* ---------- toast + modal ---------- */
  function toast(message, kind = "success") {
    const region = $("#toastRegion"); if (!region) return;
    const el = h("div", { class: "toast toast-" + kind }, h("span", { text: message }));
    while (region.children.length >= 3) region.firstElementChild.remove();
    region.append(el); setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 220); }, kind === "error" ? 5200 : 3200);
  }
  function modal({ title, body, actions = [], wide = false, onClose }) {
    const prev = document.activeElement;
    const close = () => { back.remove(); document.removeEventListener("keydown", key, true); if (prev && prev.focus) prev.focus(); if (onClose) onClose(); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const back = h("div", { class: "ap-modal-back", onmousedown: e => { if (e.target === back) close(); } },
      h("div", { class: "ap-modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "ap-modal-head" }, h("h3", { text: title }), h("button", { class: "icon-button", type: "button", "aria-label": "Close", onclick: close, text: "✕" })),
        h("div", { class: "ap-modal-body" }, body),
        actions.length ? h("div", { class: "ap-modal-actions" }, actions.map(a => h("button", { type: "button", class: a.primary ? "primary-button" : a.danger ? "secondary-button ap-danger" : "secondary-button", onclick: async ev => { if (a.close !== false) close(); if (a.onClick) await a.onClick(ev, close); } }, a.label))) : null));
    document.body.append(back); document.addEventListener("keydown", key, true);
    const f = back.querySelector("input,textarea,select,.primary-button,button:not(.icon-button)"); if (f) setTimeout(() => f.focus(), 30);
    return close;
  }
  const confirmBox = (title, text, label = "Confirm", danger = false) => new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    modal({ title, body: h("p", { text }), onClose: () => fin(false), actions: [{ label: "Cancel", onClick: () => fin(false) }, { label, primary: !danger, danger, onClick: () => fin(true) }] });
  });
  const copy = async t => { try { await navigator.clipboard.writeText(t); toast("Copied."); } catch { toast("Copy failed. Select the text and copy it manually.", "warn"); } };
  function showSecret(title, note, secret) {
    modal({ title, body: h("div", {}, h("p", { text: note }), h("input", { class: "text-field ap-mono", readonly: true, value: secret, onfocus: e => e.target.select() }), h("p", { class: "ap-muted", text: "Treat this like a password. Anyone who has it can act as you." })),
      actions: [{ label: "Copy", primary: true, close: false, onClick: () => copy(secret) }, { label: "Done" }] });
  }

  /* ---------- API ---------- */
  async function api(method, path, body) {
    if (!S.token) throw Object.assign(new Error("Connect your workspace first."), { status: 401 });
    let res; try { res = await fetch(API + "/api/automation" + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.token }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw Object.assign(new Error("Could not reach the server. Check your connection."), { status: 0 }); }
    let data = {}; try { data = await res.json(); } catch { /* none */ }
    if (res.status === 401) { disconnect(true); throw Object.assign(new Error("Your access token is not valid or has expired."), { status: 401 }); }
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
    return data;
  }
  async function guard(fn) { try { return await fn(); } catch (e) { toast(e.message || "Something went wrong.", "error"); return null; } }
  Object.assign(App, { api, toast, modal, confirmBox, copy, showSecret, fmtDate, fmtDur, ago, pill, can, guard, ERROR_HELP });

  /* ---------- small UI pieces ---------- */
  const note = (title, text) => h("div", { class: "ap-empty" }, h("p", { class: "empty-title", text: title }), text ? h("p", { class: "empty-text", text }) : null);
  const spinner = () => h("div", { class: "ap-loading", role: "status" }, "Loading…");
  const stat = (label, value, sub, tone) => h("article", { class: "stat-card ap-stat" }, h("div", { class: "stat-body" }, h("div", { class: "stat-label", text: label }), h("div", { class: "stat-value" + (tone ? " tone-" + tone : ""), text: String(value) }), sub ? h("div", { class: "stat-note", text: sub }) : null));
  const panel = (title, ...kids) => h("section", { class: "ap-panel" }, title ? h("h3", { class: "engine-subheading", text: title }) : null, ...kids);
  const btn = (label, onclick, cls = "action-button", extra = {}) => h("button", { type: "button", class: cls, onclick, ...extra }, label);
  const setView = (name, node) => { const el = $("#view-" + name); if (el) el.replaceChildren(node); };
  const jsonBlock = v => h("pre", { class: "run-pre" }, JSON.stringify(v, null, 2));

  /* ---------- navigation ---------- */
  const PUBLIC_VIEWS = new Set(["simple", "help"]);
  function go(name) {
    S.view = name;
    document.querySelectorAll(".ap-view").forEach(v => { v.hidden = v.id !== "view-" + name; });
    document.querySelectorAll("#apTabs [data-view]").forEach(b => b.setAttribute("aria-selected", b.dataset.view === name ? "true" : "false"));
    const locked = !S.token && !PUBLIC_VIEWS.has(name);
    $("#apGate").hidden = !locked; if (locked) { document.querySelectorAll(".ap-view").forEach(v => { v.hidden = true; }); renderGate(); return; }
    const v = App.views[name]; if (v) Promise.resolve(v()).catch(e => toast(e.message || "Could not load this page.", "error"));
  }
  App.go = go;
  function updateBell() { const c = $("#apBell"); if (c) { c.textContent = S.unread > 99 ? "99+" : String(S.unread); c.hidden = !S.unread; } }
  async function refreshUnread() { if (!S.token) return; try { const d = await api("GET", "/notifications"); S.unread = d.unread; updateBell(); if (S.view === "notifications") renderNotifications(d); } catch { /* quiet */ } }

  /* ---------- connection ---------- */
  function renderGate() {
    const input = h("input", { class: "text-field", type: "password", id: "apTokenInput", autocomplete: "off", placeholder: "Paste your access token", "aria-label": "Access token" });
    const status = h("p", { class: "ap-muted", role: "status" });
    const go2 = async () => { const t = input.value.trim(); if (!t) { status.textContent = "Paste your access token first."; return; } status.textContent = "Connecting…"; const ok = await connect(t); if (!ok) status.textContent = "That token was not accepted. Check it and try again, or ask your administrator."; };
    input.addEventListener("keydown", e => { if (e.key === "Enter") go2(); });
    $("#apGate").replaceChildren(h("div", { class: "cloud-sync-panel ap-gate-card" },
      h("div", { class: "cloud-sync-copy" }, h("div", { class: "eyebrow", text: "Your workspace" }), h("h2", { text: "Enter your workspace" }),
        h("p", { text: "Your administrator gives you a private access token. It opens your own workspace: your workflows, executions and results are never visible to other clients." }),
        h("p", { class: "ap-muted", text: "Just exploring? Open “Simple drafts” to build and test drafts in this browser without a token." })),
      h("div", { class: "cloud-sync-controls" }, h("label", { class: "cloud-token", for: "apTokenInput", text: "Access token" }), input, h("div", { class: "cloud-sync-actions" }, btn("Connect", go2, "primary-button"), btn("Open simple drafts", () => go("simple"), "secondary-button")), status)));
  }
  async function connect(token, quiet) {
    S.token = token;
    try { S.me = await api("GET", "/me"); } catch (e) { S.token = ""; S.me = null; if (!quiet) toast(e.message, "error"); return false; }
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
    renderUser(); $("#apGate").hidden = true;
    if (!localStorage.getItem(TOUR_KEY)) setTimeout(tour, 400);
    refreshUnread(); go(S.view === "simple" ? "simple" : S.view || "overview"); return true;
  }
  function disconnect(silent) {
    S.token = ""; S.me = null; S.unread = 0; try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    renderUser(); updateBell(); if (!silent) toast("Disconnected."); go(PUBLIC_VIEWS.has(S.view) ? S.view : "overview");
  }
  function renderUser() {
    const box = $("#apUser"); if (!box) return;
    box.replaceChildren(...(S.me ? [h("div", { class: "ap-user-text" }, h("strong", { text: S.me.name || "You" }), h("span", { text: `${S.me.client.name} · ${S.me.role.replace(/_/g, " ")}` })), btn("Disconnect", () => disconnect(false), "action-button")] : []));
  }

  /* ---------- Overview ---------- */
  App.views.overview = async function () {
    setView("overview", spinner());
    const d = await api("GET", "/dashboard"); S.unread = d.unread; updateBell();
    const rate = d.executions.total ? Math.round((d.executions.completed / d.executions.total) * 100) : null;
    const usedPct = Math.min(100, Math.round((d.usage.runs_today / d.usage.max_runs_per_day) * 100));
    setView("overview", h("div", {},
      h("section", { class: "welcome-section" }, h("div", { class: "welcome-copy" }, h("div", { class: "eyebrow" }, h("span", { class: "status-dot" }), S.me.client.name), h("h1", { text: "Make work flow." }),
        h("p", { class: "welcome-description", text: "Build workflows by hand or describe them to ALPHA-O AUTOMATE AI, test them safely, then activate when you are ready." })),
        h("div", { class: "ap-actions" }, can("create") ? btn("New workflow", () => App.openBuilder(null), "primary-button") : null, can("edit") ? btn("Ask ALPHA-O AUTOMATE AI", () => App.openCopilot(), "secondary-button ap-ai") : null)),
      h("section", { class: "stats-grid ap-stats" }, stat("Total workflows", d.workflows.total), stat("Active", d.workflows.active, "Running for real", "ok"), stat("Drafts", d.workflows.draft), stat("Paused", d.workflows.paused), stat("Scheduled", d.workflows.scheduled, "With an active schedule"),
        stat("Executions", d.executions.total), stat("Successful", d.executions.completed, rate === null ? "" : rate + "% success rate", "ok"), stat("Failed", d.executions.failed, d.executions.retrying ? d.executions.retrying + " retrying" : "", d.executions.failed ? "bad" : "")),
      h("div", { class: "ap-grid2" },
        panel("Recent activity", d.recent.length ? h("ul", { class: "ap-list" }, d.recent.map(r => h("li", { class: "ap-row", onclick: () => { S.exSel = r.run_id; go("executions"); } }, h("div", {}, h("strong", { text: r.workflow_name || "(deleted workflow)" }), h("span", { class: "ap-muted", text: ` · ${ago(r.started_at)}${r.mode === "test" ? " · test" : ""}` })), pill(r.status)))) : note("Nothing has run yet", "Test a workflow, then activate it to see activity here.")),
        panel("Workflow performance (7 days)", d.performance.length ? h("ul", { class: "ap-list" }, d.performance.map(p => h("li", {}, h("div", { class: "ap-row-split" }, h("strong", { text: p.name || "(deleted)" }), h("span", { class: "ap-muted", text: `${p.total} runs · ${fmtDur(p.avg_ms)} avg` })), h("div", { class: "ap-bar", role: "img", "aria-label": `${Math.round((p.ok / p.total) * 100)}% successful` }, h("span", { style: `width:${Math.round((p.ok / p.total) * 100)}%` }))))) : note("No data yet")),
        panel("Recent notifications" + (d.unread ? ` (${d.unread} unread)` : ""), d.notifications.length ? h("ul", { class: "ap-list" }, d.notifications.map(n => h("li", { class: "ap-row" + (n.read_at ? "" : " unread"), onclick: () => go("notifications") }, h("div", {}, h("strong", { text: n.title }), h("span", { class: "ap-muted", text: ` · ${ago(n.created_at)}` })), h("span", { class: "badge", text: n.category })))) : note("No notifications")),
        panel("Usage", h("p", { text: `${d.usage.runs_today} of ${d.usage.max_runs_per_day} executions used today` }), h("div", { class: "ap-bar" }, h("span", { style: `width:${usedPct}%` })),
          h("p", { class: "ap-muted", text: `${d.workflows.total} of ${d.usage.max_workflows} workflows in this workspace.` }),
          h("div", { class: "ap-actions" }, btn("Browse templates", () => go("templates")), btn("How it works", () => go("help")), btn("Quick tour", tour))))));
  };

  /* ---------- Workflows ---------- */
  function downloadJSON(name, data) { const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: name.replace(/[^\w.-]+/g, "_") + ".json" }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  async function runDialog(w) {
    const area = h("textarea", { class: "text-field ap-mono", rows: 6, spellcheck: "false" }, "{}");
    modal({ title: `Run “${w.name}”`, body: h("div", {}, h("p", { text: "This runs the workflow for real. Its internal steps will create tasks, notifications, reports or stored data." }), h("label", { class: "field-label", for: "x" }, "Input data (JSON, optional)"), area, h("p", { class: "ap-muted", text: "Do not enter passwords or tokens." })),
      actions: [{ label: "Cancel" }, { label: "Run now", primary: true, onClick: async () => { let input; try { input = JSON.parse(area.value || "{}"); } catch { toast("The input is not valid JSON.", "error"); return; }
        const r = await guard(() => api("POST", `/workflows/${w.id}/run`, { input, idempotency_key: crypto.randomUUID() })); if (r) { toast(r.duplicate ? "Already ran." : `Run ${r.status.toLowerCase()}.`, r.status === "Failed" ? "error" : "success"); S.exSel = r.run_id; renderWorkflows(); } } }] });
  }
  async function activateDialog(w, resume) {
    const ok = await confirmBox(resume ? "Resume this workflow?" : "Activate this workflow?", `“${w.name}” will start working${resume ? " again" : ""}: manual runs, its schedule, webhook or internal events can now run it, and its internal actions create real tasks, notifications, reports and stored data. You can pause it at any time.`, resume ? "Resume" : "Activate");
    if (!ok) return false;
    try { await api("POST", `/workflows/${w.id}/${resume ? "resume" : "activate"}`, { confirm: true }); toast(resume ? "Workflow resumed." : "Workflow activated."); return true; }
    catch (e) { const errs = e.data && e.data.validation && e.data.validation.errors; modal({ title: "It can't be activated yet", body: h("div", {}, h("p", { text: e.message }), errs ? h("ul", {}, errs.map(x => h("li", { text: x }))) : null), actions: [{ label: "OK", primary: true }] }); return false; }
  }
  App.activateDialog = activateDialog; App.runDialog = runDialog; App.downloadJSON = downloadJSON;
  async function wfAction(w, a) {
    if (a === "run") return runDialog(w);
    if (a === "activate" || a === "resume") { if (await activateDialog(w, a === "resume")) renderWorkflows(); return; }
    if (a === "delete") { if (!(await confirmBox("Delete this workflow?", `“${w.name}” and its run history will be removed permanently. Tasks and reports it already created stay in Results.`, "Delete", true))) return; if (await guard(() => api("DELETE", `/workflows/${w.id}`))) { toast("Workflow deleted."); renderWorkflows(); } return; }
    if (a === "export") { const d = await guard(() => api("GET", `/workflows/${w.id}`)); if (d) downloadJSON(w.name, { name: d.workflow.name, category: d.workflow.category, description: d.workflow.description, definition: d.workflow.definition }); return; }
    if (a === "history") { S.exFilter = "all"; S.exWorkflow = w.id; go("executions"); return; }
    if (a === "open") return App.openBuilder(w.id);
    const r = await guard(() => api("POST", `/workflows/${w.id}/${a}`, {})); if (r) { toast({ duplicate: "Copied as a new draft.", pause: "Workflow paused.", archive: "Workflow archived.", restore: "Workflow restored as a draft." }[a] || "Done."); renderWorkflows(); }
  }
  async function renderWorkflows() {
    const list = h("div", { class: "ap-wf-list" }, spinner());
    const q = h("input", { class: "text-field", type: "search", placeholder: "Search workflows", "aria-label": "Search workflows", value: S.wfFilter.q });
    const st = h("select", { class: "text-field", "aria-label": "Filter by status" }, [["", "All (not archived)"], ["draft", "Drafts"], ["active", "Active"], ["paused", "Paused"], ["archived", "Archived"]].map(([v, l]) => h("option", { value: v, selected: v === S.wfFilter.status }, l)));
    let timer; q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { S.wfFilter.q = q.value; load(); }, 300); }); st.addEventListener("change", () => { S.wfFilter.status = st.value; load(); });
    setView("workflows", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Workflows" }), h("p", { text: "Create, test, activate, schedule and organise your automations." })), h("div", { class: "ap-actions" }, q, st, can("create") ? btn("New workflow", () => App.openBuilder(null), "primary-button") : null)), list));
    async function load() {
      const d = await guard(() => api("GET", `/workflows?status=${encodeURIComponent(S.wfFilter.status)}&q=${encodeURIComponent(S.wfFilter.q)}`)); if (!d) { list.replaceChildren(note("Could not load workflows")); return; }
      if (!d.workflows.length) { list.replaceChildren(note(S.wfFilter.q || S.wfFilter.status ? "No matching workflows" : "No workflows yet", "Create one, start from a template, or ask ALPHA-O AUTOMATE AI.")); return; }
      list.replaceChildren(...d.workflows.map(w => {
        const acts = [["open", "Open"], can("run") && w.status === "active" ? ["run", "Run"] : null, can("schedule") && w.status === "draft" ? ["activate", "Activate"] : null, can("schedule") && w.status === "paused" ? ["resume", "Resume"] : null, can("edit") && w.status === "active" ? ["pause", "Pause"] : null,
          can("create") ? ["duplicate", "Duplicate"] : null, ["export", "Export"], ["history", "History"], can("edit") && w.status !== "archived" ? ["archive", "Archive"] : null, can("edit") && w.status === "archived" ? ["restore", "Restore"] : null, can("delete") ? ["delete", "Delete"] : null].filter(Boolean);
        return h("article", { class: "workflow-card ap-wf" }, h("div", { class: "workflow-main" }, h("div", { class: "workflow-title-row" }, h("h3", { class: "workflow-name", text: w.name }), pill(w.status), h("span", { class: "badge", text: w.category || "other" }), w.trigger_type ? h("span", { class: "badge", text: "Trigger: " + w.trigger_type }) : null),
          w.description ? h("p", { class: "workflow-description", text: w.description }) : null,
          h("div", { class: "workflow-meta", text: `Updated ${ago(w.updated_at)} · Last run ${ago(w.last_run_at)}${w.next_run_at ? " · Next run " + fmtDate(w.next_run_at) : ""}${w.webhook_enabled ? " · Webhook on" : ""}` })),
          h("div", { class: "workflow-card-actions ap-wrap" }, acts.map(([a, l]) => btn(l, () => wfAction(w, a), "action-button" + (a === "delete" ? " action-delete" : "")))));
      }));
    }
    load();
  }
  App.views.workflows = renderWorkflows;

  /* ---------- Executions ---------- */
  const EX_FILTERS = [["all", "All"], ["success", "Successful"], ["failed", "Failed"], ["running", "Running"], ["retrying", "Retrying"], ["cancelled", "Cancelled"]];
  async function renderExecutions() {
    const table = h("div", { class: "ap-ex-list" }, spinner()), detail = h("div", { class: "ap-ex-detail" });
    const chips = h("div", { class: "ap-chips", role: "group", "aria-label": "Filter executions" }, EX_FILTERS.map(([k, l]) => h("button", { type: "button", class: "ap-chip", "aria-pressed": S.exFilter === k ? "true" : "false", onclick: () => { S.exFilter = k; renderExecutions(); } }, l)));
    const tests = h("label", { class: "ap-check" }, h("input", { type: "checkbox", checked: S.exTests, onchange: e => { S.exTests = e.target.checked; renderExecutions(); } }), " Show test runs");
    setView("executions", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Executions" }), h("p", { text: "Every run, with its steps, timing, retries and errors." })), tests), chips, S.exWorkflow ? h("p", { class: "ap-muted" }, "Showing one workflow only. ", btn("Show all", () => { S.exWorkflow = null; renderExecutions(); })) : null, h("div", { class: "ap-ex-grid" }, table, detail)));
    const qs = `limit=60${S.exFilter !== "all" ? "&status=" + S.exFilter : ""}${S.exTests ? "" : "&mode=live"}${S.exWorkflow ? "&workflow_id=" + S.exWorkflow : ""}`;
    const d = await guard(() => api("GET", "/executions?" + qs)); if (!d) { table.replaceChildren(note("Could not load executions")); return; }
    if (!d.executions.length) table.replaceChildren(note("No executions here", "Runs appear after you test or run a workflow."));
    else table.replaceChildren(...d.executions.map(r => h("button", { type: "button", class: "ap-ex-row" + (r.run_id === S.exSel ? " selected" : ""), onclick: () => { S.exSel = r.run_id; renderExecutions(); } },
      h("div", { class: "ap-ex-main" }, h("strong", { text: r.workflow_name || "(deleted workflow)" }), h("span", { class: "ap-muted", text: `${fmtDate(r.started_at)} · ${r.trigger_type || "manual"}${r.mode === "test" ? " · test" : ""}` }), h("span", { class: "ap-muted", text: `${fmtDur(r.duration_ms)} · ${r.steps_done} steps${r.steps_failed ? ", " + r.steps_failed + " failed" : ""}${r.attempt > 1 ? " · attempt " + r.attempt : ""}` })), pill(r.status))));
    if (S.exSel) showExecution(S.exSel, detail); else detail.append(note("Select an execution", "Choose a run to inspect its steps."));
  }
  async function showExecution(id, box) {
    box.replaceChildren(spinner()); const d = await guard(() => api("GET", "/executions/" + id)); if (!d) { box.replaceChildren(note("Could not load this execution")); return; }
    const e = d.execution; const err = e.steps.find(s => s.error_code);
    box.replaceChildren(h("article", { class: "run-report" },
      h("header", { class: "run-report-head" }, h("div", { class: "run-report-title" }, h("h4", { text: e.workflow_name || "(deleted workflow)" }), h("div", { class: "run-meta" }, "Execution ID ", h("code", { text: e.run_id }), e.mode === "test" ? " · Test run" : "")), pill(e.status)),
      h("dl", { class: "run-times" }, [["Started", fmtDate(e.started_at)], ["Completed", e.finished_at ? fmtDate(e.finished_at) : e.status === "Retrying" ? "Retry at " + fmtDate(e.next_retry_at) : "Not finished"], ["Duration", fmtDur(e.duration_ms)], ["Trigger", e.trigger_type || "manual"], ["Attempt", `${e.attempt} of ${e.max_attempts}`], ["Steps", `${e.steps_done} done, ${e.steps_failed} failed`]].map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))),
      e.error_message ? h("div", { class: "run-block run-block-error" }, h("div", { class: "run-block-title", text: "What went wrong" }), h("p", { text: e.error_message }), err && ERROR_HELP[err.error_code] ? h("p", { class: "ap-muted", text: ERROR_HELP[err.error_code] }) : null) : null,
      h("ol", { class: "run-steps" }, e.steps.map(s => h("li", { class: "run-step run-step-" + (s.status === "Completed" ? "success" : "failed") }, h("div", { class: "run-step-head" }, h("span", { class: "run-step-title", text: `${s.seq}. ${s.label || s.node_type}` }), pill(s.status)),
        h("div", { class: "run-step-body" }, h("p", { text: s.summary || "" }), h("span", { class: "ap-muted", text: fmtDur(s.duration_ms) }), s.error_message ? h("p", { class: "ap-bad", text: `${s.error_code}: ${s.error_message}` }) : null, Object.keys(s.output || {}).length ? h("details", { class: "run-details" }, h("summary", { text: "Step data" }), jsonBlock(s.output)) : null)))),
      e.attempts.length > 1 ? h("details", { class: "run-details", open: true }, h("summary", { text: `Retry history (${e.attempts.length} attempts)` }), h("ul", {}, e.attempts.map(a => h("li", {}, `Attempt ${a.attempt}: ${a.status}${a.error_message ? " — " + a.error_message : ""} (${fmtDate(a.started_at)})`)))) : null,
      h("details", { class: "run-details" }, h("summary", { text: "Input data (sensitive-looking fields hidden)" }), jsonBlock(e.input)), h("details", { class: "run-details" }, h("summary", { text: "Values produced" }), jsonBlock(e.output)),
      h("details", { class: "run-details" }, h("summary", { text: `Log (${e.logs.length})` }), h("ol", { class: "run-log" }, e.logs.map(l => h("li", { class: "log-" + (l.level === "WARN" ? "warn" : l.level === "ERROR" ? "error" : "info") }, h("time", { text: new Date(l.created_at).toLocaleTimeString() }), " ", l.message)))),
      h("div", { class: "ap-actions" }, can("run") && (e.status === "Failed" || e.status === "Cancelled") && e.mode === "live" ? btn("Retry now", async () => { const r = await guard(() => api("POST", `/executions/${e.run_id}/retry`, {})); if (r) { toast("Retry " + r.status.toLowerCase() + ".", r.status === "Failed" ? "error" : "success"); S.exSel = r.run_id; renderExecutions(); } }, "primary-button") : null,
        can("run") && ["Queued", "Retrying", "Running"].includes(e.status) ? btn("Cancel execution", async () => { if (await confirmBox("Cancel this execution?", "A running execution stops before its next step.", "Cancel it", true)) { const r = await guard(() => api("POST", `/executions/${e.run_id}/cancel`, {})); if (r) { toast(r.status === "Cancelling" ? "Cancelling…" : "Cancelled."); renderExecutions(); } } }, "secondary-button ap-danger") : null)));
  }
  App.views.executions = renderExecutions;

  /* ---------- Notifications ---------- */
  function renderNotifications(d) {
    const draw = data => { S.unread = data.unread; updateBell(); setView("notifications", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Notifications" }), h("p", { text: "Alerts about your workflows. Email and chat notifications are not connected yet." })), data.unread ? btn("Mark all as read", async () => { if (await guard(() => api("POST", "/notifications/read", { all: true }))) refreshUnread(); }, "primary-button") : null),
      data.notifications.length ? h("ul", { class: "ap-list ap-notes" }, data.notifications.map(n => h("li", { class: "ap-row ap-note-" + n.category + (n.read_at ? "" : " unread") }, h("div", { class: "ap-grow" }, h("strong", { text: n.title }), n.message ? h("p", { class: "ap-muted", text: n.message }) : null, h("span", { class: "ap-muted", text: `${fmtDate(n.created_at)} · ${n.category}` })),
        h("div", { class: "ap-actions" }, n.run_id ? btn("View", () => { S.exSel = n.run_id; go("executions"); }) : null, !n.read_at ? btn("Mark read", async () => { if (await guard(() => api("POST", "/notifications/read", { ids: [n.id] }))) refreshUnread(); }) : null)))) : note("No notifications yet"))); };
    if (d) draw(d); else guard(() => api("GET", "/notifications")).then(x => x && draw(x));
  }
  App.views.notifications = () => renderNotifications();

  /* ---------- Results ---------- */
  App.views.results = async function () {
    setView("results", spinner()); const d = await api("GET", "/results");
    setView("results", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Results" }), h("p", { text: "What your active workflows have created: tasks, reports and stored data." }))),
      h("div", { class: "ap-grid2" },
        panel("Tasks", d.tasks.length ? h("ul", { class: "ap-list" }, d.tasks.map(t => h("li", { class: "ap-row" }, h("div", { class: "ap-grow" }, h("strong", { class: t.status === "done" ? "ap-done" : "", text: t.title }), h("span", { class: "ap-muted", text: ` · ${t.priority}${t.due ? " · due " + t.due : ""} · ${t.workflow_name || "workflow"} · ${ago(t.created_at)}` })),
          can("edit") ? btn(t.status === "done" ? "Reopen" : "Mark done", async () => { if (await guard(() => api("POST", `/tasks/${t.id}/status`, { status: t.status === "done" ? "open" : "done" }))) App.views.results(); }) : null))) : note("No tasks yet")),
        panel("Reports", d.reports.length ? d.reports.map(r => h("details", { class: "run-details" }, h("summary", { text: `${r.title} · ${ago(r.created_at)}` }), h("pre", { class: "run-pre", text: r.body || "" }))) : note("No reports yet")),
        panel("Stored workflow data", d.data.length ? h("div", { class: "ap-tablewrap" }, h("table", { class: "ap-table" }, h("thead", {}, h("tr", {}, ["Workflow", "Key", "Value", "Updated"].map(x => h("th", { text: x })))), h("tbody", {}, d.data.map(x => h("tr", {}, h("td", { text: x.workflow_name || "—" }), h("td", { text: x.k }), h("td", { text: typeof x.value === "object" ? JSON.stringify(x.value) : String(x.value) }), h("td", { text: ago(x.updated_at) })))))) : note("No stored data yet")))));
  };

  /* ---------- API management ---------- */
  App.views.api = async function () {
    setView("api", spinner());
    if (!can("api")) { setView("api", note("Your role cannot manage API access", "Ask a workspace owner or developer.")); return; }
    const [docs, tokens, usage] = await Promise.all([api("GET", "/docs"), api("GET", "/tokens"), api("GET", "/usage")]);
    const name = h("input", { class: "text-field", placeholder: "Token name, e.g. CI server", maxlength: "60", "aria-label": "Token name" });
    setView("api", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "API access" }), h("p", { text: "Use tokens to call the same workflow API this page uses. Tokens act with your role and expire." }))),
      h("div", { class: "ap-grid2" },
        panel("Your API tokens", h("div", { class: "ap-actions" }, name, btn("Create token", async () => { const r = await guard(() => api("POST", "/tokens", { name: name.value })); if (r) { showSecret("Your new token", r.note, r.token); App.views.api(); } }, "primary-button")),
          tokens.tokens.length ? h("ul", { class: "ap-list" }, tokens.tokens.map(t => h("li", { class: "ap-row" }, h("div", { class: "ap-grow" }, h("strong", { text: `${t.name} (${t.prefix}…)` }), h("span", { class: "ap-muted", text: ` · ${t.member_name} · last used ${ago(t.last_used_at)} · ${t.revoked_at ? "revoked" : "expires " + fmtDate(t.expires_at)}` })),
            t.revoked_at ? null : btn("Revoke", async () => { if (await confirmBox("Revoke this token?", "Anything using it will stop working immediately.", "Revoke", true)) { if (await guard(() => api("DELETE", "/tokens/" + t.id))) App.views.api(); } }, "action-button action-delete")))) : note("No tokens yet")),
        panel("Usage (last 24 hours)", h("p", { text: `${usage.last_24h.total} requests · ${usage.last_24h.errors} errors · ${usage.last_24h.avg_ms} ms average` }), h("p", { class: "ap-muted", text: `Rate limit: ${usage.rate_limit_per_minute} requests per minute for each token. Over the limit you receive HTTP 429.` }),
          h("details", { class: "run-details" }, h("summary", { text: "Recent requests" }), h("div", { class: "ap-tablewrap" }, h("table", { class: "ap-table" }, h("tbody", {}, usage.recent.map(r => h("tr", {}, h("td", { text: new Date(r.ts).toLocaleTimeString() }), h("td", { text: r.method }), h("td", { text: r.path }), h("td", { class: r.status >= 400 ? "ap-bad" : "", text: String(r.status) }), h("td", { text: r.ms + " ms" }))))))))),
      panel("Endpoints", h("p", { class: "ap-muted" }, "Base address: ", h("code", { text: API }), ". Send ", h("code", { text: "Authorization: Bearer <token>" }), " and JSON bodies. Errors return ", h("code", { text: '{"error": "..."}' }), "."),
        h("div", { class: "ap-tablewrap" }, h("table", { class: "ap-table" }, h("tbody", {}, docs.endpoints.map(e => h("tr", {}, h("td", {}, h("span", { class: "badge", text: e.method })), h("td", {}, h("code", { text: e.route })), h("td", { text: e.description })))))))));
  };

  /* ---------- Team ---------- */
  App.views.team = async function () {
    setView("team", spinner());
    if (!can("users")) { setView("team", note("Your role cannot manage users", "Ask an agency owner or administrator.")); return; }
    const d = await api("GET", "/members"); const nm = h("input", { class: "text-field", placeholder: "Full name", maxlength: "80", "aria-label": "Name" }), em = h("input", { class: "text-field", type: "email", placeholder: "Email (optional)", "aria-label": "Email" });
    const role = h("select", { class: "text-field", "aria-label": "Role" }, ["client", "viewer", "developer", "agency_admin", "agency_owner"].map(r => h("option", { value: r }, r.replace(/_/g, " "))));
    const PERMS = ["view", "create", "edit", "delete", "run", "schedule", "executions", "api", "users"];
    setView("team", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Team and permissions" }), h("p", { text: "People in this workspace and what each role allows. Permissions are enforced on the server." }))),
      h("div", { class: "ap-grid2" },
        panel("Add a person", h("div", { class: "ap-form" }, nm, em, role, btn("Add and create access token", async () => { const r = await guard(() => api("POST", "/members", { name: nm.value, email: em.value, role: role.value })); if (r) { showSecret("Access token for " + nm.value, r.note, r.token); App.views.team(); } }, "primary-button"))),
        panel("Members", h("ul", { class: "ap-list" }, d.members.map(m => h("li", { class: "ap-row" }, h("div", { class: "ap-grow" }, h("strong", { text: m.name }), h("span", { class: "ap-muted", text: ` · ${m.role.replace(/_/g, " ")}${m.email ? " · " + m.email : ""}` })), pill(m.status === "active" ? "active" : "paused"),
          m.id !== (S.me && S.me.member_id) ? btn(m.status === "active" ? "Disable" : "Enable", async () => { if (await guard(() => api("PUT", "/members/" + m.id, { role: m.role, status: m.status === "active" ? "disabled" : "active" }))) App.views.team(); }) : null))))),
      panel("Role permissions", h("div", { class: "ap-tablewrap" }, h("table", { class: "ap-table" }, h("thead", {}, h("tr", {}, h("th", { text: "Role" }), PERMS.map(p => h("th", { text: p })))), h("tbody", {}, Object.entries(d.roles).filter(([r]) => r !== "platform_admin").map(([r, ps]) => h("tr", {}, h("td", { text: r.replace(/_/g, " ") }), PERMS.map(p => h("td", { text: ps.includes(p) ? "✓" : "—" })))))))))); 
  };

  /* ---------- Help and onboarding ---------- */
  const TOUR = [
    ["What ALPHA-O Automate does", "It runs your repeatable business tasks for you. A workflow starts from a trigger, checks conditions, and then performs actions such as creating tasks, sending you notifications, producing reports or storing data."],
    ["Create a workflow", "Choose New workflow, or start from a template. A workflow is a flow chart: Trigger → (optional If / else) → Actions → Complete. You do not need to write code."],
    ["Let ALPHA-O AUTOMATE AI build it", "Choose Ask ALPHA-O AUTOMATE AI and describe the job in plain words, for example “Follow up customers with unpaid invoices”. It drafts the workflow, you review it, and nothing is activated without your approval."],
    ["Use the visual builder", "Drag steps in from the left, join them by dragging from a step's round connector to the next step, and click any step to change its settings. Red badges show what still needs fixing."],
    ["Test, then activate", "Test workflow shows exactly what each step would do without saving anything. When you are happy, Save and then Activate. Only activated workflows run for real."],
    ["Monitor and retry", "Executions shows every run with its steps, timing and errors. Failed runs retry automatically if you set a retry policy, and you can retry any failed run yourself."]];
  function tour() {
    let i = 0; const body = h("div", { class: "ap-tour" }); const title = { text: "" };
    const draw = () => { body.replaceChildren(h("p", { class: "ap-muted", text: `Step ${i + 1} of ${TOUR.length}` }), h("h4", { text: TOUR[i][0] }), h("p", { text: TOUR[i][1] })); };
    draw(); let close;
    const nav = [{ label: "Skip", close: true, onClick: () => localStorage.setItem(TOUR_KEY, "1") }, { label: "Back", close: false, onClick: () => { i = Math.max(0, i - 1); draw(); } },
      { label: "Next", primary: true, close: false, onClick: () => { if (i < TOUR.length - 1) { i++; draw(); } else { localStorage.setItem(TOUR_KEY, "1"); close(); } } }];
    close = modal({ title: "Welcome to ALPHA-O Automate", body, actions: nav, onClose: () => localStorage.setItem(TOUR_KEY, "1") });
  }
  App.tour = tour;
  App.views.help = function () {
    setView("help", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Help and documentation" }), h("p", { text: "Everything you need to get started." }))),
      h("div", { class: "ap-grid2" },
        panel("Getting started", h("ol", { class: "ap-steps" }, TOUR.map(t => h("li", {}, h("strong", { text: t[0] + ". " }), t[1]))), btn("Replay the quick tour", tour, "secondary-button")),
        panel("What runs today (and what doesn't)", h("ul", {}, [
          "Real now: manual runs, schedules, webhooks and internal events; conditions; creating tasks; notifications in this platform; reports; stored workflow data; retries; execution history.",
          "Not connected yet: email, Slack, Google Sheets, Microsoft apps and any other outside service. Steps that need them are shown as disabled and cannot be activated.",
          "Schedules are checked once a minute and use the time zone you choose, so a run may start up to about a minute late. Missed runs while the service is down are skipped, not replayed.",
          "Each run executes at most 25 steps. A workflow has at most 50 steps. Loops are not allowed; use the retry setting for retries.",
          "Notifications appear in this platform only. Email and chat notifications are disabled."].map(t => h("li", { text: t })))),
        panel("Writing conditions", h("p", { text: C.CONDITION_HELP }), h("p", { class: "ap-muted", text: "Use {{field}} in text boxes to insert data from the run, and {{vars.name}} for values created by earlier steps." })),
        panel("Keyboard shortcuts in the builder", h("ul", {}, ["Delete: remove the selected step or connection", "Ctrl/⌘ + Z: undo, Ctrl/⌘ + Y: redo", "Ctrl/⌘ + D: duplicate the selected step", "Mouse wheel or the + / − buttons: zoom; drag the empty canvas to move around"].map(t => h("li", { text: t })))),
        panel("About", h("p", { text: "ALPHA-O Business Automation is part of the ALPHA-O platform, created by ITUZE Richard, Senior Software Developer / IT professional, in the context of L'espace." }),
          h("p", { class: "ap-muted", text: "It runs on a GitHub Pages front end, a Cloudflare Worker back end and a Cloudflare D1 database. ALPHA-O AUTOMATE AI uses the platform's existing AI providers through the back end; no keys are ever sent to your browser." })))));
  };

  /* ---------- init ---------- */
  function init() {
    document.querySelectorAll("#apTabs [data-view]").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
    window.addEventListener("beforeunload", e => { if (App.isDirty && App.isDirty()) { e.preventDefault(); e.returnValue = ""; } });
    setInterval(() => { if (S.token && !document.hidden) { refreshUnread(); if (S.view === "executions" && !S.exSel) renderExecutions(); } }, 90000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshUnread(); });
    renderUser(); updateBell();
    let saved = ""; try { saved = sessionStorage.getItem(TOKEN_KEY) || ""; } catch { /* ignore */ }
    if (saved) connect(saved, true).then(ok => { if (!ok) go("overview"); }); else go("overview");
  }
  App.init = init; App.refreshUnread = refreshUnread; App.renderWorkflows = renderWorkflows; App.panel = panel; App.note = note; App.btn = btn; App.spinner = spinner; App.jsonBlock = jsonBlock; App.setView = setView;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0)); else setTimeout(init, 0);
})();

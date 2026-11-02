"use strict";
/* ALPHA-O Automate studio: visual builder screen, inspector, tests, templates and ALPHA-O AUTOMATE AI.
 * Depends on alphao-core.js, automate-builder.js and automate-platform.js. */
(() => {
  const App = window.AlphaOApp, C = window.AlphaOCore, BLD = window.AlphaOBuilder;
  if (!App || !C || !BLD) { console.error("Alpha-O Studio: required scripts did not load."); return; }
  const { h, S, api, toast, modal, guard, pill, can, fmtDate, ago } = App;
  const btn = App.btn;
  const CATEGORIES = [["business", "Business operations"], ["communication", "Communication"], ["productivity", "Productivity"], ["reporting", "Data and reporting"], ["other", "Other"]];
  const BLANK = () => ({ nodes: [{ id: "t1", type: "trigger.manual", label: "Manual start", x: 40, y: 120, config: {} }, { id: "end", type: "control.end", label: "Complete", x: 320, y: 120, config: {} }], edges: [{ id: "e1", from: "t1", to: "end" }], settings: {} });

  let B = null, cur = null, loading = false, vTimer = null, lastValidation = null;
  const ui = {};
  App.isDirty = () => Boolean(cur && cur.dirty);

  /* ---------- local (browser) simulation: identical logic to the server, but nothing is saved ---------- */
  function simulate(node, ctx) {
    const c = node.config, R = t => C.resolve(t, ctx);
    const say = { "action.create_task": `Would create task “${R(c.title)}” (${c.priority || "normal"}).`, "action.notify": `Would add notification “${R(c.title)}”.`, "action.update_data": `Would ${c.mode || "set"} “${c.key}” to “${R(c.value)}”.`, "action.report": `Would save report “${R(c.title)}”.` }[node.type];
    if (!say) throw new C.CoreError("NO_HANDLER", "This step cannot run.");
    return { summary: say, output: { simulated: true } };
  }
  const localRun = (def, input) => C.executeGraph(def, input, { runAction: async (n, ctx) => simulate(n, ctx) });
  function renderRun(result) {
    return h("div", {}, h("p", {}, "Result: ", pill(result.status), result.error ? h("span", { class: "ap-bad", text: ` ${result.error.message}` }) : null),
      h("ol", { class: "run-steps" }, result.steps.map(s => h("li", { class: "run-step run-step-" + (s.status === "Completed" ? "success" : "failed") }, h("div", { class: "run-step-head" }, h("span", { class: "run-step-title", text: `${s.seq}. ${s.label}` }), pill(s.status)), h("div", { class: "run-step-body" }, h("p", { text: s.summary }), s.error && App.ERROR_HELP[s.error.code] ? h("p", { class: "ap-muted", text: App.ERROR_HELP[s.error.code] }) : null)))),
      Object.keys(result.vars || {}).length ? h("details", { class: "run-details" }, h("summary", { text: "Values produced" }), App.jsonBlock(result.vars)) : null, h("p", { class: "ap-muted", text: "Test only: nothing was saved, sent or changed." }));
  }
  function testDialog(def, title = "Test workflow", scopeNode) {
    const area = h("textarea", { class: "text-field ap-mono", rows: 7, spellcheck: "false", "aria-label": "Test input (JSON)" }, JSON.stringify({ customer: "Acme Ltd", amount: 250, priority: "urgent", status: "open" }, null, 2));
    const out = h("div", { class: "ap-test-out", "aria-live": "polite" });
    const read = () => { try { const v = JSON.parse(area.value || "{}"); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0; return v; } catch { toast("Test input must be a JSON object, like {\"priority\": \"urgent\"}.", "error"); return null; } };
    const actions = [{ label: "Close" }, { label: "Run test", primary: true, close: false, onClick: async () => { const input = read(); if (!input) return; const v = C.validateDefinition(def); if (!v.definition || !v.definition.nodes.length) { out.replaceChildren(h("p", { class: "ap-bad", text: "Add a trigger and at least one step first." })); return; }
      const d = scopeNode ? { nodes: [{ id: "tt", type: "trigger.manual", label: "Test start", config: {} }, C.clone(scopeNode)], edges: [{ id: "x", from: "tt", to: scopeNode.id }] } : v.definition;
      try { out.replaceChildren(renderRun(await localRun(d, input))); } catch (e) { out.replaceChildren(h("p", { class: "ap-bad", text: e.message })); } } }];
    if (!scopeNode && cur && cur.id && !cur.dirty && can("run")) actions.splice(1, 0, { label: "Run test on server", close: false, onClick: async () => { const input = read(); if (!input) return; const r = await guard(() => api("POST", `/workflows/${cur.id}/test`, { input })); if (r) { out.replaceChildren(h("p", {}, "Server test finished: ", pill(r.status), " — saved in Executions as a test run. No tasks, reports or data were created.", r.error ? h("span", { class: "ap-bad", text: " " + r.error.message }) : null)); } } });
    modal({ title, wide: true, body: h("div", {}, h("p", { class: "ap-muted", text: scopeNode ? "Runs only this step with the data below." : "Runs the whole workflow in your browser with the data below. Nothing is saved." }), h("label", { class: "field-label", text: "Test input (JSON)" }), area, out), actions });
  }
  function previewDialog(def) {
    const lines = C.outline(def);
    modal({ title: "Workflow preview", body: lines.length ? h("ul", { class: "ap-outline" }, lines.map(l => h("li", { style: `margin-left:${l.depth * 18}px` }, l.tag ? h("span", { class: "badge ap-tag-" + l.tag, text: l.tag }) : null, " ", h("strong", { text: l.label }), h("span", { class: "ap-muted", text: ` — ${(C.NODE_TYPES[l.type] || {}).label || l.type}` })))) : h("p", { text: "Nothing to preview yet." }), actions: [{ label: "Close", primary: true }] });
  }

  /* ---------- validation + problems ---------- */
  function revalidate() {
    if (!B) return; const def = B.getDefinition(); const v = C.validateDefinition(def); lastValidation = v; B.markErrors(v.nodeErrors);
    const count = v.errors.length, warn = v.warnings.length;
    if (ui.valBtn) { ui.valBtn.textContent = count ? `${count} problem${count > 1 ? "s" : ""}` : warn ? `${warn} note${warn > 1 ? "s" : ""}` : "Valid"; ui.valBtn.className = "action-button" + (count ? " ap-has-errors" : ""); }
    if (ui.problems) ui.problems.replaceChildren(...(count || warn ? [h("ul", {}, v.errors.map(m => h("li", { class: "ap-bad", text: m })), v.warnings.map(m => h("li", { class: "ap-warn", text: m })))] : [h("p", { class: "ap-muted", text: "No problems found. This workflow is ready to save and activate." })]));
    updateButtons();
  }
  function updateButtons() {
    if (!cur || !ui.save) return;
    ui.save.disabled = !can("edit") && !(!cur.id && can("create")); ui.save.textContent = cur.dirty ? "Save draft" : cur.id ? "Saved" : "Save draft";
    ui.status.replaceChildren(cur.id ? pill(cur.status) : h("span", { class: "badge", text: "Not saved yet" }), cur.dirty ? h("span", { class: "badge ap-unsaved", text: "Unsaved changes" }) : null, cur.legacy_edit ? h("span", { class: "badge", title: "This workflow was edited in the Simple drafts editor after its diagram was saved, so the diagram was rebuilt from those simpler fields.", text: "Rebuilt from simple editor" }) : null);
    ui.activate.hidden = !(cur.id && (cur.status === "draft" || cur.status === "paused") && can("schedule")); ui.activate.textContent = cur.status === "paused" ? "Resume" : "Activate";
    ui.pause.hidden = !(cur.id && cur.status === "active" && can("edit")); ui.undo.disabled = !B.canUndo(); ui.redo.disabled = !B.canRedo();
  }

  /* ---------- save / activate ---------- */
  async function save() {
    if (!cur) return false; const def = B.getDefinition();
    const body = { name: cur.name.trim() || "Untitled workflow", category: cur.category, description: cur.description, definition: def };
    if (cur.id) body.expected_version = cur.version;
    try {
      const r = await api(cur.id ? "PUT" : "POST", cur.id ? `/workflows/${cur.id}` : "/workflows", body);
      cur.id = r.id; cur.version = r.version; cur.dirty = false; if (!cur.status) cur.status = "draft"; cur.legacy_edit = false;
      const v = r.validation; toast(v && v.errors.length ? `Saved. ${v.errors.length} problem(s) to fix before it can be activated.` : "Saved."); updateButtons(); renderInspector(); return true;
    } catch (e) {
      if (e.data && e.data.code === "conflict") modal({ title: "This workflow changed elsewhere", body: h("p", { text: "Someone else (or another tab) saved a newer version. Reload to see it. Your unsaved changes here would be lost, so export them first if you need them." }), actions: [{ label: "Keep editing" }, { label: "Reload latest", primary: true, onClick: () => { cur.dirty = false; App.openBuilder(cur.id); } }] });
      else toast(e.message, "error"); return false;
    }
  }
  async function activate() {
    if (cur.dirty && !(await save())) return;
    const v = C.validateDefinition(B.getDefinition(), { activation: true });
    if (!v.ok) { toast("Fix the problems first.", "error"); ui.problemsWrap.open = true; revalidateActivation(v); return; }
    if (await App.activateDialog({ id: cur.id, name: cur.name }, cur.status === "paused")) App.openBuilder(cur.id);
  }
  function revalidateActivation(v) { ui.problems.replaceChildren(h("ul", {}, v.errors.map(m => h("li", { class: "ap-bad", text: m })), v.warnings.map(m => h("li", { class: "ap-warn", text: m })))); }

  /* ---------- inspector ---------- */
  const optLabel = o => { const op = C.OPERATORS.find(x => x[0] === o); return op ? op[1] : o.replace(/[_.-]/g, " "); };
  function field(f, value, onCommit) {
    const id = "f-" + f.key + Math.random().toString(36).slice(2, 6); let input;
    if (f.kind === "select") input = h("select", { class: "text-field", id }, ...(f.required ? [] : [h("option", { value: "" }, "(choose)")]), f.options.map(o => h("option", { value: o, selected: o === value }, optLabel(o))));
    else if (f.kind === "textarea") input = h("textarea", { class: "text-field", id, rows: 3, maxlength: String(f.max || 500) }, value || "");
    else input = h("input", { class: "text-field", id, type: "text", maxlength: String(f.max || 500), placeholder: f.placeholder || "", value: value || "" });
    input.addEventListener("change", () => onCommit(input.value));
    return h("div", { class: "field" }, h("label", { class: "field-label", for: id, text: f.label + (f.required ? " *" : "") }), input);
  }
  function renderInspector() {
    if (!B || !ui.inspector) return; const sel = B.selected(); const box = ui.inspector;
    if (sel && sel.kind === "node") {
      const n = B.getNode(sel.id); if (!n) { box.replaceChildren(); return; } const sp = C.NODE_TYPES[n.type]; const errs = (lastValidation && lastValidation.nodeErrors[n.id]) || [];
      box.replaceChildren(h("h3", { class: "engine-subheading", text: sp.label }), h("p", { class: "ap-muted", text: sp.info || "" }), sp.disabled ? h("div", { class: "run-block run-block-warn", text: "This needs an external service that is not connected yet. It is disabled and blocks activation." }) : null,
        errs.length ? h("div", { class: "run-block run-block-error" }, errs.map(m => h("p", { text: m }))) : null,
        h("div", { class: "field" }, h("label", { class: "field-label", text: "Step name" }), h("input", { class: "text-field", maxlength: "60", value: n.label, onchange: e => B.updateNode(n.id, { label: e.target.value.trim() || sp.label }) })),
        sp.fields.map(f => field(f, n.config[f.key], v => { B.updateNode(n.id, { config: { [f.key]: v } }); renderInspector(); })),
        n.type.startsWith("trigger") ? null : h("div", { class: "field" }, h("label", { class: "field-label", text: "If this step fails" }), h("select", { class: "text-field", onchange: e => B.updateNode(n.id, { on_error: e.target.value === "continue" ? "continue" : "" }) }, h("option", { value: "stop", selected: n.on_error !== "continue" }, "Stop the workflow (or use a failure path)"), h("option", { value: "continue", selected: n.on_error === "continue" }, "Carry on to the next step"))),
        n.type.includes("{{") ? null : h("p", { class: "ap-muted", text: "Tip: type {{field}} to insert data from the run, or {{vars.name}} for earlier results." }),
        h("div", { class: "ap-actions" }, !C.isTrigger(n.type) ? btn("Test this step", () => testDialog(B.getDefinition(), "Test this step", n)) : null, btn("Duplicate", () => B.duplicateNode(n.id)), btn("Delete", () => B.deleteSelection(), "action-button action-delete")));
      return;
    }
    if (sel && sel.kind === "edge") {
      const e = B.getEdge(sel.id); if (!e) { box.replaceChildren(); return; }
      box.replaceChildren(h("h3", { class: "engine-subheading", text: "Connection" }), h("div", { class: "field" }, h("label", { class: "field-label", text: "Path type" }), h("select", { class: "text-field", onchange: ev => { B.updateEdge(e.id, { branch: ev.target.value }); renderInspector(); } }, [["", "Normal"], ["true", "If true"], ["false", "If false"], ["error", "If a step fails"]].map(([v, l]) => h("option", { value: v, selected: v === (e.branch || "") }, l)))),
        h("div", { class: "ap-actions" }, btn("Delete connection", () => B.deleteSelection(), "action-button action-delete")));
      return;
    }
    renderSettings(box);
  }
  function renderSettings(box) {
    const def = B.getDefinition(), st = def.settings || {}, retry = st.retry || { max_attempts: 1, interval_seconds: 60, backoff: "fixed" }, notify = st.notify || { success: true, failure: true };
    const trig = def.nodes.find(n => C.isTrigger(n.type));
    const set = fn => { B.updateSettings(fn); renderInspector(); };
    box.replaceChildren(h("h3", { class: "engine-subheading", text: "Workflow settings" }),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "wfName", text: "Name" }), h("input", { class: "text-field", id: "wfName", maxlength: "120", value: cur.name, oninput: e => { cur.name = e.target.value; cur.dirty = true; updateButtons(); } })),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "wfCat", text: "Category" }), h("select", { class: "text-field", id: "wfCat", onchange: e => { cur.category = e.target.value; cur.dirty = true; updateButtons(); } }, CATEGORIES.map(([v, l]) => h("option", { value: v, selected: v === cur.category }, l)))),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "wfDesc", text: "Notes and expected result" }), h("textarea", { class: "text-field", id: "wfDesc", rows: 3, maxlength: "2000", oninput: e => { cur.description = e.target.value; cur.dirty = true; updateButtons(); } }, cur.description || "")),
      h("h4", { class: "ap-h4", text: "If something fails" }),
      h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Attempts" }), h("input", { class: "text-field", type: "number", min: "1", max: "5", value: retry.max_attempts, onchange: e => set(s => { s.retry = { ...retry, max_attempts: Math.min(5, Math.max(1, Number(e.target.value) || 1)) }; }) })),
      h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Wait (seconds)" }), h("input", { class: "text-field", type: "number", min: "30", max: "86400", value: retry.interval_seconds, onchange: e => set(s => { s.retry = { ...retry, interval_seconds: Math.min(86400, Math.max(30, Number(e.target.value) || 60)) }; }) })),
      h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Wait pattern" }), h("select", { class: "text-field", onchange: e => set(s => { s.retry = { ...retry, backoff: e.target.value }; }) }, [["fixed", "Same wait each time"], ["exponential", "Longer each time"]].map(([v, l]) => h("option", { value: v, selected: v === retry.backoff }, l)))),
      h("p", { class: "ap-muted", text: "Only temporary problems (like a storage hiccup) are retried. Mistakes in the workflow are not." }),
      h("h4", { class: "ap-h4", text: "Notifications" }), h("label", { class: "ap-check" }, h("input", { type: "checkbox", checked: notify.success !== false, onchange: e => set(s => { s.notify = { ...notify, success: e.target.checked }; }) }), " Tell me when it succeeds"), h("label", { class: "ap-check" }, h("input", { type: "checkbox", checked: notify.failure !== false, onchange: e => set(s => { s.notify = { ...notify, failure: e.target.checked }; }) }), " Tell me when it fails"),
      trig && trig.type === "trigger.schedule" ? scheduleEditor(st.schedule, sch => set(s => { s.schedule = sch; })) : null,
      trig && trig.type === "trigger.webhook" ? h("div", {}, h("h4", { class: "ap-h4", text: "Webhook address" }), cur.id ? h("div", { class: "ap-actions" }, btn("Create or replace address", async () => { if (cur.dirty && !(await save())) return; const r = await guard(() => api("POST", `/workflows/${cur.id}/webhook`, {})); if (r) { const full = "https://alpha-o-api.ituzerichard6.workers.dev" + r.path; App.showSecret("Your webhook address", "Send a POST with a JSON body to this address to start the workflow (it must be active). " + r.note, full); } }), btn("Turn off", async () => { if (await guard(() => api("DELETE", `/workflows/${cur.id}/webhook`))) toast("Webhook turned off."); })) : h("p", { class: "ap-muted", text: "Save the workflow first to create its private address." })) : null,
      cur.id ? h("p", { class: "ap-muted", text: `Version ${cur.version} · created ${fmtDate(cur.created_at)} · updated ${ago(cur.updated_at)}` }) : null);
  }
  function scheduleEditor(sch, onChange) {
    const s = sch || { kind: "daily", time: "09:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
    const tzList = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC", "Africa/Kigali", "Europe/London", "America/New_York"];
    const upd = patch => onChange({ ...s, ...patch });
    const kinds = [["interval", "Every few minutes"], ["daily", "Every day"], ["weekly", "Certain weekdays"], ["monthly", "Once a month"], ["once", "One time"]];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const runs = []; if (sch) { try { let t = Date.now(); for (let i = 0; i < 3; i++) { t = C.nextRunAfter(sch, t); if (!t) break; runs.push(t); } } catch { /* ignore */ } }
    return h("div", {}, h("h4", { class: "ap-h4", text: "Schedule" }),
      h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Repeat" }), h("select", { class: "text-field", onchange: e => { const k = e.target.value; onChange({ kind: k, timezone: s.timezone, ...(k === "interval" ? { every_minutes: 60 } : k === "once" ? { at: new Date(Date.now() + 3600000).toISOString() } : { time: "09:00" }), ...(k === "weekly" ? { days: [1] } : {}), ...(k === "monthly" ? { day: 1 } : {}) }); } }, kinds.map(([v, l]) => h("option", { value: v, selected: v === s.kind }, l)))),
      s.kind === "interval" ? h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Every (minutes, 5 or more)" }), h("input", { class: "text-field", type: "number", min: "5", max: "10080", value: s.every_minutes || 60, onchange: e => upd({ every_minutes: Math.max(5, Number(e.target.value) || 60) }) })) : null,
      ["daily", "weekly", "monthly"].includes(s.kind) ? h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "At" }), h("input", { class: "text-field", type: "time", value: s.time || "09:00", onchange: e => upd({ time: e.target.value || "09:00" }) })) : null,
      s.kind === "weekly" ? h("div", { class: "ap-days", role: "group", "aria-label": "Weekdays" }, days.map((d, i) => h("label", { class: "ap-check" }, h("input", { type: "checkbox", checked: (s.days || []).includes(i), onchange: e => { const set = new Set(s.days || []); e.target.checked ? set.add(i) : set.delete(i); upd({ days: [...set].sort() }); } }), " " + d))) : null,
      s.kind === "monthly" ? h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Day of month (1–28)" }), h("input", { class: "text-field", type: "number", min: "1", max: "28", value: s.day || 1, onchange: e => upd({ day: Math.min(28, Math.max(1, Number(e.target.value) || 1)) }) })) : null,
      s.kind === "once" ? h("div", { class: "ap-form-row" }, h("label", { class: "field-label", text: "Date and time (your time zone below)" }), h("input", { class: "text-field", type: "datetime-local", value: s.at ? new Date(new Date(s.at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "", onchange: e => upd({ at: e.target.value ? new Date(e.target.value).toISOString() : null }) })) : null,
      h("div", { class: "ap-form-row" }, h("label", { class: "field-label", for: "tz", text: "Time zone" }), h("input", { class: "text-field", id: "tz", list: "tzlist", value: s.timezone || "UTC", onchange: e => { if (C.validTimezone(e.target.value)) upd({ timezone: e.target.value }); else { toast("Unknown time zone.", "error"); e.target.value = s.timezone; } } }), h("datalist", { id: "tzlist" }, tzList.map(z => h("option", { value: z })))),
      runs.length ? h("p", { class: "ap-muted", text: "Next runs: " + runs.map(r => new Date(r).toLocaleString()).join(" · ") }) : null,
      cur.id && cur.schedule ? h("p", { class: "ap-muted", text: `Server: ${cur.schedule.status}. Next ${cur.schedule.next_run_at ? fmtDate(cur.schedule.next_run_at) : "—"} · previous ${cur.schedule.last_run_at ? fmtDate(cur.schedule.last_run_at) : "—"}` }) : null,
      h("p", { class: "ap-muted", text: "Schedules are checked once a minute, so a run can start up to about a minute late. Pause the workflow to pause the schedule." }));
  }

  /* ---------- builder screen ---------- */
  function ensureBuilder() {
    if (B) return;
    const host = document.getElementById("view-builder");
    const tool = (label, fn, extra = {}) => h("button", { type: "button", class: "action-button", onclick: fn, ...extra }, label);
    ui.undo = tool("Undo", () => B.undo(), { title: "Undo (Ctrl+Z)" }); ui.redo = tool("Redo", () => B.redo(), { title: "Redo (Ctrl+Y)" });
    ui.valBtn = tool("Valid", () => { ui.problemsWrap.open = !ui.problemsWrap.open; }); ui.save = h("button", { type: "button", class: "primary-button", onclick: save }, "Save draft");
    ui.activate = h("button", { type: "button", class: "primary-button ap-green", onclick: activate }, "Activate"); ui.pause = tool("Pause", async () => { if (await guard(() => api("POST", `/workflows/${cur.id}/pause`, {}))) { toast("Paused."); App.openBuilder(cur.id); } });
    ui.status = h("div", { class: "ap-status" }); ui.canvas = h("div", { class: "apb-canvas" }); ui.inspector = h("aside", { class: "apb-inspector", "aria-label": "Settings" });
    ui.problems = h("div", { class: "ap-problems" }); ui.problemsWrap = h("details", { class: "apb-problems" }, h("summary", { text: "Problems and notes" }), ui.problems);
    const pal = h("aside", { class: "apb-palette", "aria-label": "Steps you can add" }, h("h3", { class: "engine-subheading", text: "Add a step" }), h("p", { class: "ap-muted", text: "Click or drag onto the canvas." }));
    ["Triggers", "Conditions", "Actions", "Control"].forEach(g => { pal.append(h("h4", { class: "ap-h4", text: g })); Object.entries(C.NODE_TYPES).filter(([, s]) => s.group === g).forEach(([t, s]) => pal.append(h("button", { type: "button", class: "apb-chip" + (s.disabled ? " disabled" : ""), draggable: "true", title: s.info, onclick: () => B.addNode(t), ondragstart: e => { e.dataTransfer.setData("text/x-alphao-node", t); e.dataTransfer.effectAllowed = "copy"; } }, s.label))); });
    host.replaceChildren(h("div", { class: "apb-shell" },
      h("div", { class: "apb-top" }, tool("← Workflows", () => App.go("workflows")), h("div", { class: "apb-title" }, h("strong", { id: "apbName", text: "Workflow" }), ui.status), h("div", { class: "apb-tools" },
        ui.undo, ui.redo, tool("−", () => B.zoom(0.85), { "aria-label": "Zoom out" }), tool("+", () => B.zoom(1.15), { "aria-label": "Zoom in" }), tool("Fit", () => B.fit()), tool("Arrange", () => B.autoLayout()), ui.valBtn, tool("Preview", () => previewDialog(B.getDefinition())), tool("Test workflow", () => testDialog(B.getDefinition())), tool("Export", () => App.downloadJSON(cur.name || "workflow", { name: cur.name, category: cur.category, description: cur.description, definition: B.getDefinition() })),
        can("edit") ? tool("Ask ALPHA-O AUTOMATE AI", () => App.openCopilot(), { class: "action-button ap-ai" }) : null, ui.pause, ui.activate, ui.save)),
      h("div", { class: "apb-body" }, pal, ui.canvas, ui.inspector), ui.problemsWrap));
    B = BLD.create({ container: ui.canvas, toast, onChange: () => { if (!loading && cur) { cur.dirty = true; } clearTimeout(vTimer); vTimer = setTimeout(revalidate, 120); updateButtons(); }, onSelect: renderInspector });
    App.builder = B;
  }
  App.openBuilder = async function (id, o = {}) {
    if (!S.token) { App.go("overview"); return; }
    ensureBuilder();
    if (cur && cur.dirty && (id === null || cur.id !== id || o.template || o.definition) && !(await App.confirmBox("Discard unsaved changes?", "The workflow you are editing has changes that are not saved.", "Discard changes", true))) { App.go("builder"); return; }
    loading = true;
    try {
      if (id) {
        const d = await api("GET", "/workflows/" + id); const w = d.workflow;
        cur = { id: w.id, name: w.name, category: w.category || "other", description: w.description || "", status: w.status, version: w.version, legacy_edit: w.legacy_edit, created_at: w.created_at, updated_at: w.updated_at, schedule: w.schedule, dirty: false };
        B.setDefinition(w.definition);
      } else {
        const t = o.template; cur = { id: null, name: (t && t.name) || o.name || "Untitled workflow", category: (t && t.category) || "business", description: (t && t.description) || "", status: "draft", version: 1, dirty: Boolean(t || o.definition), schedule: null };
        B.setDefinition((t && t.definition) || o.definition || BLANK());
      }
    } catch (e) { loading = false; toast(e.message, "error"); return; }
    loading = false; document.getElementById("apbName").textContent = cur.name; App.go("builder"); revalidate(); renderInspector(); setTimeout(() => B.fit(), 60);
  };
  App.views.builder = function () { if (!cur) { App.openBuilder(null); return; } ensureBuilder(); updateButtons(); setTimeout(() => { B.redraw(); }, 30); };
  document.addEventListener("input", e => { if (e.target && e.target.id === "wfName") { const t = document.getElementById("apbName"); if (t) t.textContent = e.target.value || "Workflow"; } });

  /* ---------- templates ---------- */
  function flow(trig, steps, settings) {
    const nodes = [], edges = []; let n = 0; const add = (type, label, config, x, y) => { const id = (type.startsWith("trigger") ? "t" : type.startsWith("condition") ? "c" : type.startsWith("control") ? "x" : "a") + ++n; nodes.push({ id, type, label, x, y, config: config || {} }); return id; };
    const link = (a, b, branch) => edges.push({ id: "e" + (edges.length + 1), from: a, to: b, ...(branch ? { branch } : {}) });
    const t = add(trig[0], trig[1], trig[2], 40, 150);
    const run = (list, prev, branch, x, y) => { for (const s of list) { if (s.if) { const c = add("condition.if", s.label || "Check", s.if, x, y); link(prev, c, branch); run(s.then || [], c, "true", x + 250, y - 70); run(s.else || [], c, "false", x + 250, y + 110); return; } const a = add(s[0], s[1], s[2], x, y); link(prev, a, branch); prev = a; branch = undefined; x += 250; } const e = add("control.end", "Complete", {}, x, y); link(prev, e, branch); };
    run(steps, t, undefined, 290, 150); return { schema: C.SCHEMA, settings: settings || {}, nodes, edges };
  }
  const TASK = (title, priority = "normal") => ["action.create_task", "Create task", { title, priority }], NOTE = (title, message = "", category = "info") => ["action.notify", "Notify me", { title, message, category }], EXT = (what, integration = "email") => ["action.external", what + " (needs integration)", { integration, note: what }];
  const TEMPLATES = [
    { key: "follow", name: "Customer follow-up", category: "communication", description: "Create a follow-up task when a customer request is still open.", definition: flow(["trigger.manual", "Start follow-up", {}], [{ label: "Still open?", if: { field: "status", operator: "equals", value: "open" }, then: [TASK("Follow up with {{customer}}"), ["action.update_data", "Count follow-ups", { key: "followups", value: "1", mode: "increment" }], NOTE("Follow-up created", "For {{customer}}", "success")], else: [NOTE("No follow-up needed", "{{customer}} is not open")] }]) },
    { key: "lead", name: "Lead management", category: "business", description: "Score incoming leads: hot leads get a high-priority task, others are counted.", definition: flow(["trigger.webhook", "Lead received", {}], [{ label: "Hot lead?", if: { field: "score", operator: "gte", value: "70" }, then: [TASK("Call hot lead {{name}}", "high"), ["action.update_data", "Count hot leads", { key: "hot_leads", value: "1", mode: "increment" }], NOTE("Hot lead: {{name}}", "Score {{score}}", "attention")], else: [["action.update_data", "Count other leads", { key: "other_leads", value: "1", mode: "increment" }]] }]) },
    { key: "tasks", name: "Task management", category: "productivity", description: "Every weekday morning, create a planning task and tell you about it.", definition: flow(["trigger.schedule", "Every weekday 08:00", {}], [TASK("Plan today's priorities", "normal"), NOTE("Daily planning task created", "Open Results to see it")], { schedule: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00", timezone: "UTC" } }) },
    { key: "onboard", name: "Employee onboarding", category: "business", description: "Create the standard onboarding tasks for a new employee. The welcome email needs an integration.", definition: flow(["trigger.manual", "New employee", {}], [TASK("Prepare workstation for {{employee}}"), TASK("Set up accounts for {{employee}}"), TASK("Schedule orientation for {{employee}}"), EXT("Send welcome email to {{employee}}"), NOTE("Onboarding started", "{{employee}}", "success")]) },
    { key: "report", name: "Business reporting", category: "reporting", description: "Add up the figures you provide and save a short report.", definition: flow(["trigger.manual", "Send figures", {}], [["action.process", "Add up sales", { operation: "sum", target: "total_sales", source: "online_sales,store_sales" }], ["action.process", "Write summary", { operation: "template", target: "summary", template: "Total sales: {{vars.total_sales}}" }], ["action.report", "Save report", { title: "Sales report", fields: "online_sales,store_sales,vars.total_sales" }], NOTE("Sales report ready", "{{vars.summary}}", "success")]) },
    { key: "invoice", name: "Invoice follow-up", category: "business", description: "Create a task for overdue invoices. The reminder email needs an integration.", definition: flow(["trigger.webhook", "Invoice checked", {}], [{ label: "Overdue?", if: { field: "days_overdue", operator: "gt", value: "0" }, then: [TASK("Chase invoice {{invoice}} for {{customer}}", "high"), EXT("Email payment reminder to {{customer}}"), NOTE("Overdue invoice {{invoice}}", "{{days_overdue}} days", "warning")], else: [] }]) },
    { key: "support", name: "Customer support routing", category: "communication", description: "Send urgent requests to the top of your task list and flag them.", definition: flow(["trigger.webhook", "Request received", {}], [{ label: "Urgent?", if: { field: "priority", operator: "equals", value: "urgent" }, then: [TASK("URGENT: {{subject}}", "urgent"), NOTE("Urgent request", "{{subject}}", "attention")], else: [TASK("{{subject}}", "normal")] }]) },
    { key: "docs", name: "Document processing", category: "productivity", description: "Route documents by file type using the file details you provide (no files are read).", definition: flow(["trigger.manual", "Document received", {}], [{ label: "Is it a PDF?", if: { field: "file_name", operator: "ends-with", value: ".pdf" }, then: [TASK("Review PDF {{file_name}}"), ["action.update_data", "Log document", { key: "documents", value: "{{file_name}}", mode: "append" }]], else: [TASK("Check format of {{file_name}}", "low")] }]) },
    { key: "appt", name: "Appointment reminders", category: "communication", description: "Each morning, create a preparation task. Sending reminders needs an integration.", definition: flow(["trigger.schedule", "Every day 08:00", {}], [TASK("Prepare today's appointments"), EXT("Send reminders to clients", "email"), NOTE("Appointments ready", "Check Results")], { schedule: { kind: "daily", time: "08:00", timezone: "UTC" } }) },
    { key: "sales", name: "Sales pipeline management", category: "business", description: "Track deals by stage: won deals are counted and trigger an onboarding task.", definition: flow(["trigger.webhook", "Deal updated", {}], [{ label: "Won?", if: { field: "stage", operator: "equals", value: "won" }, then: [["action.update_data", "Count won deals", { key: "won_deals", value: "1", mode: "increment" }], TASK("Onboard {{client}}", "high"), NOTE("Deal won: {{client}}", "", "success")], else: [["action.update_data", "Count open deals", { key: "open_deals", value: "1", mode: "increment" }]] }]) }
  ];
  App.views.templates = function () {
    App.setView("templates", h("div", {}, h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Templates" }), h("p", { text: "Start from a ready-made workflow, then customise it before saving or activating." }))),
      h("div", { class: "template-grid ap-tpl-grid" }, TEMPLATES.map(t => { const ext = t.definition.nodes.some(n => C.NODE_TYPES[n.type].disabled);
        return h("article", { class: "template-card ap-tpl" }, h("span", { class: "template-title", text: t.name }), h("span", { class: "template-description", text: t.description }),
          h("div", { class: "ap-wrap" }, h("span", { class: "badge", text: t.category }), h("span", { class: "badge " + (ext ? "ap-badge-warn" : "badge-draft"), text: ext ? "Needs integration for some steps (disabled)" : "Internal actions only" })),
          h("div", { class: "ap-actions" }, can("create") ? btn("Use template", () => App.openBuilder(null, { template: { name: t.name, category: t.category, description: t.description, definition: C.clone(t.definition) } }), "primary-button") : null, btn("Preview", () => previewDialog(t.definition)))); }))));
  };

  /* ---------- ALPHA-O AUTOMATE AI ---------- */
  const AI = { hist: [], busy: false, mode: "auto", last: null };
  const PROMPTS = ["Create a workflow that follows up with customers who have outstanding invoices.", "Every Monday, create a task to review last week's sales.", "When a support request is urgent, create an urgent task and notify me.", "Track new leads and flag those with a score above 70."];
  function aiMode(msg) { if (AI.mode !== "auto") return AI.mode; return B && B.getDefinition().nodes.length > 2 ? (/^(explain|what does)/i.test(msg) ? "explain" : /(error|wrong|broken|fix|debug)/i.test(msg) ? "debug" : "edit") : "generate"; }
  App.openCopilot = function (prefill) {
    if (!S.token) { App.go("overview"); toast("Connect your workspace to use ALPHA-O AUTOMATE AI.", "warn"); return; }
    let drawer = document.getElementById("apCopilot"); if (!drawer) { buildCopilot(); drawer = document.getElementById("apCopilot"); }
    drawer.hidden = false; document.body.classList.add("ap-copilot-open"); const ta = drawer.querySelector("textarea"); if (prefill) ta.value = prefill; setTimeout(() => ta.focus(), 50);
  };
  function closeCopilot() { const d = document.getElementById("apCopilot"); if (d) d.hidden = true; document.body.classList.remove("ap-copilot-open"); }
  function buildCopilot() {
    const log = h("div", { class: "ap-ai-log", role: "log", "aria-live": "polite" }), ta = h("textarea", { class: "text-field", rows: 3, maxlength: "2000", placeholder: "Describe what you want, or ask me to change this workflow…", "aria-label": "Message to ALPHA-O AUTOMATE AI" });
    const send = h("button", { type: "button", class: "primary-button", id: "apAiSend" }, "Send"); const prompts = h("div", { class: "ap-prompts" });
    const modes = h("div", { class: "ap-chips", role: "group", "aria-label": "What do you want to do?" }, [["auto", "Create or edit"], ["explain", "Explain"], ["debug", "Find errors"], ["improve", "Improve"]].map(([k, l]) => h("button", { type: "button", class: "ap-chip", "aria-pressed": AI.mode === k ? "true" : "false", onclick: e => { AI.mode = k; modes.querySelectorAll(".ap-chip").forEach(c => c.setAttribute("aria-pressed", c === e.currentTarget ? "true" : "false")); } }, l)));
    const drawer = h("aside", { class: "ap-copilot", id: "apCopilot", "aria-label": "ALPHA-O AUTOMATE AI" }, h("div", { class: "ap-copilot-head" }, h("div", {}, h("strong", { text: "ALPHA-O AUTOMATE AI" }), h("span", { class: "ap-muted", text: "Describe it. I'll draft it. You approve it." })), h("button", { class: "icon-button", type: "button", "aria-label": "Close assistant", onclick: closeCopilot }, "✕")),
      modes, log, prompts, h("div", { class: "ap-ai-input" }, ta, send));
    document.body.append(drawer);
    const note = text => log.append(h("div", { class: "ap-msg ap-msg-note", text }));
    const drawPrompts = () => { prompts.replaceChildren(...(AI.hist.length ? [] : [h("p", { class: "ap-muted", text: "Try one of these:" }), ...PROMPTS.map(p => h("button", { type: "button", class: "ap-prompt", onclick: () => { ta.value = p; ta.focus(); } }, p))])); };
    drawPrompts(); note("Hi! Tell me what you want to automate. I only propose workflows; nothing is saved, activated or run until you decide.");
    async function submit(text, mode) {
      const msg = (text || ta.value).trim(); if (!msg || AI.busy) return; ta.value = ""; AI.busy = true; send.disabled = true; drawPrompts();
      log.append(h("div", { class: "ap-msg ap-msg-user", text: msg })); const prog = h("div", { class: "ap-msg ap-msg-note ap-progress" }, "Understanding your request…"); log.append(prog); log.scrollTop = log.scrollHeight;
      const steps = ["Understanding your request…", "Designing the workflow…", "Checking it against the rules…"]; let i = 0; const timer = setInterval(() => { i = Math.min(steps.length - 1, i + 1); prog.textContent = steps[i]; }, 2500);
      try {
        const def = B && cur ? B.getDefinition() : null; const m = mode || aiMode(msg);
        const r = await api("POST", "/ai", { mode: m, message: msg, definition: def && def.nodes.length ? def : undefined, history: AI.hist.slice(-6) });
        AI.hist.push({ role: "user", text: msg }, { role: "assistant", text: r.message }); AI.last = r; prog.remove(); log.append(aiBubble(r, msg));
      } catch (e) { prog.remove(); AI.hist.push({ role: "user", text: msg }); log.append(h("div", { class: "ap-msg ap-msg-error", text: e.message })); }
      finally { clearInterval(timer); AI.busy = false; send.disabled = false; log.scrollTop = log.scrollHeight; }
    }
    function aiBubble(r) {
      const v = r.validation; const b = h("div", { class: "ap-msg ap-msg-ai" }, h("p", { text: r.message }));
      if (r.questions.length) b.append(h("div", {}, h("p", { class: "ap-muted", text: "I need a little more information:" }), r.questions.map(q => h("button", { type: "button", class: "ap-prompt", onclick: () => { ta.value = q + " "; ta.focus(); } }, q))));
      if (r.changes.length) b.append(h("ul", { class: "ap-changes" }, r.changes.map(c => h("li", { text: c }))));
      if (r.removed_steps && r.removed_steps.length) b.append(h("div", { class: "run-block run-block-warn", text: "This change removes: " + r.removed_steps.join(", ") + ". Check before applying." }));
      if (r.definition) {
        b.append(h("ul", { class: "ap-outline ap-mini" }, C.outline(r.definition).map(l => h("li", { style: `margin-left:${l.depth * 14}px` }, l.tag ? h("span", { class: "badge ap-tag-" + l.tag, text: l.tag }) : null, " ", h("strong", { text: l.label })))));
        b.append(h("p", { class: v && v.ok ? "ap-ok" : "ap-bad", text: v && v.ok ? "✓ Passed validation" : "Needs fixing: " + (v ? v.errors.slice(0, 3).join(" ") : "") }), v && v.warnings.length ? h("p", { class: "ap-warn", text: v.warnings[0] }) : null);
        b.append(h("div", { class: "ap-actions" }, btn("Apply to builder", () => apply(r), "primary-button"), can("create") ? btn("Save as draft", () => saveDraft(r)) : null, btn("Test workflow", () => testDialog(r.definition, "Test AI workflow")), btn("Explain", () => submit("Explain what this workflow does in simple words.", "explain")), btn("Find errors", () => submit("Check this workflow for mistakes.", "debug"))));
      } else if (B && cur && B.getDefinition().nodes.length) b.append(h("div", { class: "ap-actions" }, btn("Find errors", () => submit("Check this workflow for mistakes.", "debug")), btn("Improve it", () => submit("Make this workflow more efficient.", "improve"))));
      b.append(h("p", { class: "ap-muted ap-prov", text: `Answered by ${r.provider}. Always review before activating.` }));
      return b;
    }
    async function apply(r) {
      if (!cur) { await App.openBuilder(null, { definition: r.definition, name: AI.hist.length ? "AI workflow" : undefined }); toast("Applied. Review it, then save."); return; }
      ensureBuilder(); B.checkpoint(); loading = true; B.setDefinition(r.definition, { resetHistory: false }); loading = false; cur.dirty = true; revalidate(); renderInspector(); App.go("builder"); toast("Applied. Use Undo to go back, then Save when you're happy.");
    }
    async function saveDraft(r) {
      const input = h("input", { class: "text-field", maxlength: "120", value: (AI.hist[0] && AI.hist[0].text.slice(0, 60)) || "AI workflow", "aria-label": "Workflow name" });
      modal({ title: "Save as draft", body: h("div", {}, h("p", { text: "Saved as a draft. It will not run until you activate it." }), input), actions: [{ label: "Cancel" }, { label: "Save draft", primary: true, onClick: async () => { const x = await guard(() => api("POST", "/workflows", { name: input.value || "AI workflow", category: "other", definition: r.definition })); if (x) { toast("Draft saved."); App.openBuilder(x.id, {}); } } }] });
    }
    send.addEventListener("click", () => submit()); ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }); drawer.addEventListener("keydown", e => { if (e.key === "Escape") closeCopilot(); });
  }
  App.views.builder.__ready = true;
})();

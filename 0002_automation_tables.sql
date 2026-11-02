-- ALPHA-O Automation — Migration 0002
-- New tables only (CREATE ... IF NOT EXISTS). Safe to run more than once.
-- Apply (after 0001):  wrangler d1 execute alpha-o-db --remote --file=migrations/0002_automation_tables.sql
-- Rollback: DROP the automation_* / workflow_versions / workflow_execution_steps /
--           workflow_schedules / workflow_notifications tables. Existing tables are untouched.

-- Tenant = client workspace. owner_id on workflows/runs/logs equals automation_clients.id.
CREATE TABLE IF NOT EXISTS automation_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  max_workflows INTEGER NOT NULL DEFAULT 50,
  max_runs_per_day INTEGER NOT NULL DEFAULT 200,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_members (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES automation_clients(id) ON DELETE CASCADE
);

-- Only the SHA-256 hash of a token is stored. The token itself is shown once.
CREATE TABLE IF NOT EXISTS automation_api_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  FOREIGN KEY (member_id) REFERENCES automation_members(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES automation_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS workflow_execution_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  summary TEXT,
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  output_json TEXT,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_notifications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workflow_id TEXT,
  run_id TEXT,
  category TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT,
  source_key TEXT UNIQUE,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  owner_id TEXT,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

-- Automation AI usage. No prompt text is stored.
CREATE TABLE IF NOT EXISTS automation_ai_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  member_id TEXT,
  mode TEXT,
  provider TEXT,
  ok INTEGER NOT NULL,
  valid INTEGER,
  duration_ms INTEGER,
  error_code TEXT
);

-- Real internal action results.
CREATE TABLE IF NOT EXISTS automation_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workflow_id TEXT,
  run_id TEXT,
  source_key TEXT UNIQUE,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  due TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_workflow_data (
  workflow_id TEXT NOT NULL,
  k TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  value_json TEXT,
  last_source_key TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, k)
);

CREATE TABLE IF NOT EXISTS automation_reports (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workflow_id TEXT,
  run_id TEXT,
  source_key TEXT UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL
);

-- API management: request history and fixed-window rate limiting.
CREATE TABLE IF NOT EXISTS automation_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  owner_id TEXT,
  token_id TEXT,
  method TEXT,
  path TEXT,
  status INTEGER,
  ms INTEGER
);

CREATE TABLE IF NOT EXISTS automation_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_system (
  k TEXT PRIMARY KEY,
  v TEXT,
  updated_at INTEGER NOT NULL
);

-- The existing administrator workspace (existing workflows already use owner_id = 'admin').
INSERT OR IGNORE INTO automation_clients (id, name, status, max_workflows, max_runs_per_day, created_at, updated_at)
VALUES ('admin', 'Platform administrator', 'active', 200, 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_members_client ON automation_members(client_id);
CREATE INDEX IF NOT EXISTS idx_tokens_member ON automation_api_tokens(member_id);
CREATE INDEX IF NOT EXISTS idx_versions_workflow ON workflow_versions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_run ON workflow_execution_steps(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON workflow_schedules(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_notifications_owner ON workflow_notifications(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_owner ON automation_audit_logs(owner_id, ts);
CREATE INDEX IF NOT EXISTS idx_ai_owner_ts ON automation_ai_requests(owner_id, ts);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON automation_tasks(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON automation_reports(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reqlog_owner ON automation_request_log(owner_id, ts);
CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_runs_owner_started ON workflow_runs(owner_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_idem ON workflow_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;

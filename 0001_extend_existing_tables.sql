-- ALPHA-O Automation — Migration 0001
-- Additive only. Run ONCE (SQLite cannot "ADD COLUMN IF NOT EXISTS").
-- No existing column, row, table or index is changed or removed.
-- Apply:  wrangler d1 execute alpha-o-db --remote --file=migrations/0001_extend_existing_tables.sql
-- Rollback: columns added here are nullable/defaulted and can simply be ignored.

ALTER TABLE workflows ADD COLUMN definition_json TEXT;
ALTER TABLE workflows ADD COLUMN definition_updated_at INTEGER;
ALTER TABLE workflows ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workflows ADD COLUMN archived_at INTEGER;
ALTER TABLE workflows ADD COLUMN webhook_hash TEXT;
ALTER TABLE workflows ADD COLUMN last_run_at INTEGER;

ALTER TABLE workflow_runs ADD COLUMN trigger_type TEXT;
ALTER TABLE workflow_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE workflow_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workflow_runs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workflow_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE workflow_runs ADD COLUMN definition_version INTEGER;
ALTER TABLE workflow_runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE workflow_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN root_run_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN next_retry_at INTEGER;
ALTER TABLE workflow_runs ADD COLUMN input_json TEXT;
ALTER TABLE workflow_runs ADD COLUMN output_json TEXT;
ALTER TABLE workflow_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN steps_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN steps_failed INTEGER NOT NULL DEFAULT 0;

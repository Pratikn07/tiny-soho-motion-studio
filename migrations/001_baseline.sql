-- Tiny Soho Studio baseline schema.
--
-- The runtime records this baseline with PRAGMA user_version = 1 inside a
-- BEGIN IMMEDIATE transaction. This file is intentionally declarative so
-- future numbered migrations remain reviewable without replaying a
-- destructive bootstrap script.

CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, canvas TEXT NOT NULL, storyboard TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, path TEXT NOT NULL, width INTEGER, height INTEGER, duration REAL, hash TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, model_id TEXT NOT NULL, task TEXT NOT NULL, prompt TEXT NOT NULL, input_asset_ids TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL, provider_task_id TEXT, output_asset_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, idempotency_key));
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, graph TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, project_id TEXT NOT NULL, graph TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, prompt TEXT NOT NULL, proposal TEXT NOT NULL, fingerprint TEXT NOT NULL, approved_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

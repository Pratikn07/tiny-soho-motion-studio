import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { databasePath, dataDir } from "./config";

export type JobStatus = "queued" | "preparing_media" | "submitting" | "submitted" | "running" | "downloading" | "processing" | "completed" | "failed" | "submission_unknown" | "needs_attention" | "canceled";
export type Project = { id: string; name: string; canvas: string; storyboard: string; createdAt: string; updatedAt: string };
export type Asset = { id: string; projectId: string | null; kind: string; name: string; mime: string; path: string; width: number | null; height: number | null; duration: number | null; hash: string; provenance: string; createdAt: string; sizeBytes?: number | null; codec?: string | null; container?: string | null; fps?: number | null };
export type Job = { id: string; projectId: string; idempotencyKey: string; modelId: string; task: string; prompt: string; inputAssetIds: string; options: string; status: JobStatus; providerTaskId: string | null; outputAssetId: string | null; error: string | null; createdAt: string; updatedAt: string };
export type PublicJob = Omit<Job, "options"> & { options: string };
export type WorkflowRun = { id: string; workflowId: string; projectId: string; graph: string; state: string; createdAt: string; updatedAt: string };

function now() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${randomUUID()}`; }
function parse<T>(value: string): T { return JSON.parse(value) as T; }
export function toPublicJob(job: Job): PublicJob {
  try {
    const options = parse<Record<string, unknown>>(job.options);
    delete options.internalProvenance;
    delete options.preparedMedia;
    return { ...job, options: JSON.stringify(options) };
  } catch {
    return { ...job, options: "{}" };
  }
}

const BASELINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, canvas TEXT NOT NULL, storyboard TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, path TEXT NOT NULL, width INTEGER, height INTEGER, duration REAL, hash TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, model_id TEXT NOT NULL, task TEXT NOT NULL, prompt TEXT NOT NULL, input_asset_ids TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL, provider_task_id TEXT, output_asset_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, idempotency_key));
  CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, graph TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, project_id TEXT NOT NULL, graph TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, prompt TEXT NOT NULL, proposal TEXT NOT NULL, fingerprint TEXT NOT NULL, approved_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

function baselineSchema() {
  const migration = path.join(process.cwd(), "migrations", "001_baseline.sql");
  try {
    return fs.readFileSync(migration, "utf8");
  } catch {
    return BASELINE_SCHEMA;
  }
}

function migrationSchema(filename: string, fallback: string) {
  try {
    return fs.readFileSync(path.join(process.cwd(), "migrations", filename), "utf8");
  } catch {
    return fallback;
  }
}

function runMigrations(db: Database.Database) {
  let version = Number(db.pragma("user_version", { simple: true }));
  if (version > 3) throw new Error(`Database schema version ${version} is newer than this application supports.`);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (version < 1) {
      db.exec(baselineSchema());
      db.pragma("user_version = 1");
      version = 1;
    }
    if (version < 2) {
      db.exec(migrationSchema("002_preparing_media.sql", "CREATE INDEX IF NOT EXISTS jobs_status_created_at ON jobs(status, created_at);"));
      db.pragma("user_version = 2");
      version = 2;
    }
    if (version < 3) {
      db.exec(migrationSchema("003_asset_media_metadata.sql", "ALTER TABLE assets ADD COLUMN size_bytes INTEGER; ALTER TABLE assets ADD COLUMN codec TEXT; ALTER TABLE assets ADD COLUMN container TEXT; ALTER TABLE assets ADD COLUMN fps REAL;"));
      db.pragma("user_version = 3");
      version = 3;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return version;
}

export function createStore(filename = databasePath()) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  const schemaVersion = runMigrations(db);
  const projectFrom = (row: any): Project => ({ id: row.id, name: row.name, canvas: row.canvas, storyboard: row.storyboard, createdAt: row.created_at, updatedAt: row.updated_at });
  const assetFrom = (row: any): Asset => ({ id: row.id, projectId: row.project_id, kind: row.kind, name: row.name, mime: row.mime, path: row.path, width: row.width, height: row.height, duration: row.duration, hash: row.hash, provenance: row.provenance, createdAt: row.created_at, sizeBytes: row.size_bytes ?? null, codec: row.codec ?? null, container: row.container ?? null, fps: row.fps ?? null });
  const jobFrom = (row: any): Job => ({ id: row.id, projectId: row.project_id, idempotencyKey: row.idempotency_key, modelId: row.model_id, task: row.task, prompt: row.prompt, inputAssetIds: row.input_asset_ids, options: row.options, status: row.status, providerTaskId: row.provider_task_id, outputAssetId: row.output_asset_id, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at });
  const runFrom = (row: any): WorkflowRun => ({ id: row.id, workflowId: row.workflow_id, projectId: row.project_id, graph: row.graph, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at });
  return {
    close: () => db.close(),
    schemaVersion: () => schemaVersion,
    createProject(name: string, canvas = "1080x1440") { const project = { id: id("project"), name: name.trim() || "Untitled project", canvas, storyboard: "[]", createdAt: now(), updatedAt: now() }; db.prepare("INSERT INTO projects VALUES (@id,@name,@canvas,@storyboard,@createdAt,@updatedAt)").run(project); return project; },
    listProjects() { return db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all().map(projectFrom); },
    getProject(projectId: string) { const row = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId); return row ? projectFrom(row) : null; },
    updateProject(projectId: string, patch: Partial<Pick<Project, "name" | "canvas" | "storyboard">>) { const existing = this.getProject(projectId); if (!existing) throw new Error("Project not found"); const next = { ...existing, ...patch, updatedAt: now() }; db.prepare("UPDATE projects SET name=@name,canvas=@canvas,storyboard=@storyboard,updated_at=@updatedAt WHERE id=@id").run(next); return next; },
    addAsset(asset: Omit<Asset, "id" | "createdAt" | "sizeBytes" | "codec" | "container" | "fps"> & Pick<Asset, "sizeBytes" | "codec" | "container" | "fps">) { const next = { ...asset, id: id("asset"), createdAt: now(), sizeBytes: asset.sizeBytes ?? null, codec: asset.codec ?? null, container: asset.container ?? null, fps: asset.fps ?? null }; db.prepare("INSERT INTO assets(id,project_id,kind,name,mime,path,width,height,duration,hash,provenance,created_at,size_bytes,codec,container,fps) VALUES (@id,@projectId,@kind,@name,@mime,@path,@width,@height,@duration,@hash,@provenance,@createdAt,@sizeBytes,@codec,@container,@fps)").run(next); return next; },
    listAssets(projectId?: string) { const rows = projectId ? db.prepare("SELECT * FROM assets WHERE project_id=? ORDER BY created_at DESC").all(projectId) : db.prepare("SELECT * FROM assets ORDER BY created_at DESC").all(); return rows.map(assetFrom); },
    getAsset(assetId: string) { const row = db.prepare("SELECT * FROM assets WHERE id=?").get(assetId); return row ? assetFrom(row) : null; },
    createJob(input: { projectId: string; idempotencyKey: string; modelId: string; task: string; prompt: string; inputAssetIds: string[]; options: Record<string, unknown> }) { const fingerprint = createHash("sha256").update(JSON.stringify({ modelId: input.modelId, task: input.task, prompt: input.prompt, inputAssetIds: input.inputAssetIds, options: input.options })).digest("hex"); const duplicate = db.prepare("SELECT * FROM jobs WHERE project_id=? AND idempotency_key=?").get(input.projectId, input.idempotencyKey) as { fingerprint: string } | undefined; if (duplicate) { if (duplicate.fingerprint !== fingerprint) throw new Error("Idempotency key was reused with a different request."); const prior = db.prepare("SELECT * FROM jobs WHERE project_id=? AND idempotency_key=?").get(input.projectId, input.idempotencyKey); return jobFrom(prior); } const next = { id: id("job"), projectId: input.projectId, idempotencyKey: input.idempotencyKey, fingerprint, modelId: input.modelId, task: input.task, prompt: input.prompt, inputAssetIds: JSON.stringify(input.inputAssetIds), options: JSON.stringify(input.options), status: "queued" as JobStatus, providerTaskId: null, outputAssetId: null, error: null, createdAt: now(), updatedAt: now() }; db.prepare("INSERT INTO jobs VALUES (@id,@projectId,@idempotencyKey,@fingerprint,@modelId,@task,@prompt,@inputAssetIds,@options,@status,@providerTaskId,@outputAssetId,@error,@createdAt,@updatedAt)").run(next); return next; },
    listJobs(projectId?: string) { const rows = projectId ? db.prepare("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC").all(projectId) : db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all(); return rows.map(jobFrom); },
    getJob(jobId: string) { const row = db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId); return row ? jobFrom(row) : null; },
    updateJobOptions(jobId: string, options: Record<string, unknown>) { const existing = this.getJob(jobId); if (!existing) throw new Error("Job not found"); const next = { ...existing, options: JSON.stringify(options), updatedAt: now() }; db.prepare("UPDATE jobs SET options=@options,updated_at=@updatedAt WHERE id=@id").run(next); return next; },
    claimNextJob() { const row = db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined; if (!row) return null; const stamp = now(); const result = db.prepare("UPDATE jobs SET status='preparing_media',updated_at=? WHERE id=? AND status='queued'").run(stamp, row.id); return result.changes ? this.getJob(row.id) : null; },
    updateJob(jobId: string, patch: Partial<Pick<Job, "status" | "providerTaskId" | "outputAssetId" | "error">>) { const existing = this.getJob(jobId); if (!existing) throw new Error("Job not found"); const next = { ...existing, ...patch, updatedAt: now() }; db.prepare("UPDATE jobs SET status=@status,provider_task_id=@providerTaskId,output_asset_id=@outputAssetId,error=@error,updated_at=@updatedAt WHERE id=@id").run(next); return next; },
    transitionJob(jobId: string, expectedStatuses: JobStatus[], patch: Partial<Pick<Job, "status" | "providerTaskId" | "outputAssetId" | "error">>) {
      if (!expectedStatuses.length) throw new Error("At least one expected job status is required.");
      const existing = this.getJob(jobId);
      if (!existing) throw new Error("Job not found");
      const next = { ...existing, ...patch, updatedAt: now() };
      const placeholders = expectedStatuses.map(() => "?").join(",");
      const result = db.prepare(`UPDATE jobs SET status=?,provider_task_id=?,output_asset_id=?,error=?,updated_at=? WHERE id=? AND status IN (${placeholders})`).run(next.status, next.providerTaskId, next.outputAssetId, next.error, next.updatedAt, jobId, ...expectedStatuses);
      return result.changes ? next : null;
    },
    cancelQueuedJob(jobId: string) {
      return this.transitionJob(jobId, ["queued"], { status: "canceled", error: "Canceled before provider submission." });
    },
    reconcileInterruptedJobs() {
      const stamp = now();
      const reconcile = db.transaction(() => {
        const preparation = db.prepare("UPDATE jobs SET status='queued',error=?,updated_at=? WHERE status='preparing_media'").run("Worker interrupted during media preparation; safe to retry before provider submission.", stamp).changes;
        const ambiguous = db.prepare("UPDATE jobs SET status='submission_unknown',error=?,updated_at=? WHERE status='submitting'").run("Worker interrupted while submitting; provider acceptance is unknown.", stamp).changes;
        const attention = db.prepare("UPDATE jobs SET status='needs_attention',error=?,updated_at=? WHERE status IN ('downloading','processing')").run("Worker interrupted during local result handling; retry downstream work explicitly.", stamp).changes;
        return { preparationReset: preparation, submissionUnknown: ambiguous, needsAttention: attention };
      });
      return reconcile();
    },
    setSetting(key: string, value: unknown) { db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, JSON.stringify(value), now()); },
    getSetting<T>(key: string): T | null { const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined; return row ? parse<T>(row.value) : null; },
    createWorkflow(name: string, graph: unknown) { const next = { id: id("workflow"), name, graph: JSON.stringify(graph), createdAt: now(), updatedAt: now() }; db.prepare("INSERT INTO workflows VALUES (@id,@name,@graph,@createdAt,@updatedAt)").run(next); return next; },
    listWorkflows() { return db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all(); },
    getWorkflow(workflowId: string) { return db.prepare("SELECT * FROM workflows WHERE id=?").get(workflowId) as { id: string; name: string; graph: string } | undefined; },
    createWorkflowRun(workflowId: string, projectId: string, graph: unknown) { const next = { id: id("run"), workflowId, projectId, graph: JSON.stringify(graph), state: JSON.stringify({ status: "running", nodes: {} }), createdAt: now(), updatedAt: now() }; db.prepare("INSERT INTO workflow_runs VALUES (@id,@workflowId,@projectId,@graph,@state,@createdAt,@updatedAt)").run(next); return next; },
    getWorkflowRun(runId: string) { const row = db.prepare("SELECT * FROM workflow_runs WHERE id=?").get(runId); return row ? runFrom(row) : null; },
    listWorkflowRuns(projectId?: string) { const rows = projectId ? db.prepare("SELECT * FROM workflow_runs WHERE project_id=? ORDER BY created_at DESC").all(projectId) : db.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC").all(); return rows.map(runFrom); },
    updateWorkflowRun(runId: string, state: unknown) { const current = this.getWorkflowRun(runId); if (!current) throw new Error("Workflow run not found"); const next = { ...current, state: JSON.stringify(state), updatedAt: now() }; db.prepare("UPDATE workflow_runs SET state=@state,updated_at=@updatedAt WHERE id=@id").run(next); return next; },
    createProposal(projectId: string, prompt: string, proposal: unknown) { const text = JSON.stringify(proposal); const next = { id: id("proposal"), projectId, prompt, proposal: text, fingerprint: createHash("sha256").update(text).digest("hex"), createdAt: now() }; db.prepare("INSERT INTO proposals(id,project_id,prompt,proposal,fingerprint,created_at) VALUES (@id,@projectId,@prompt,@proposal,@fingerprint,@createdAt)").run(next); return { ...next, proposal }; },
    getProposal(proposalId: string) { return db.prepare("SELECT * FROM proposals WHERE id=?").get(proposalId) as any; },
    approveProposal(proposalId: string) { const proposal = this.getProposal(proposalId); if (!proposal) throw new Error("Proposal not found"); if (proposal.approved_at) throw new Error("Proposal is already approved"); db.prepare("UPDATE proposals SET approved_at=? WHERE id=?").run(now(), proposalId); return this.getProposal(proposalId); },
  };
}

let singleton: ReturnType<typeof createStore> | undefined;
export function store() { return singleton ??= createStore(); }
export function ensureDataDirectories() { fs.mkdirSync(dataDir(), { recursive: true }); }

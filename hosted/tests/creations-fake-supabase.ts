type Row = Record<string, any>;

const ACTIVE_RUN = ["queued", "generating", "finishing", "checking"];

/** Unique keys the fake enforces, including the partial "one active run per slide" index. */
const uniqueKeys: Record<string, Array<{ columns: string[]; where?: (row: Row) => boolean }>> = {
  creative_studio_assets: [{ columns: ["id"] }, { columns: ["object_path"] }],
  creative_studio_projects: [{ columns: ["id"] }],
  creative_studio_pipeline_runs: [
    { columns: ["id"] },
    { columns: ["project_id", "idempotency_key"] },
    { columns: ["project_id", "slide_id"], where: (row) => ACTIVE_RUN.includes(row.status) },
  ],
  creative_studio_takes: [{ columns: ["id"] }, { columns: ["run_id", "attempt"] }],
  creative_studio_jobs: [{ columns: ["id"] }, { columns: ["project_id", "idempotency_key"] }],
  creative_studio_vision_jobs: [{ columns: ["id"] }, { columns: ["project_id", "idempotency_key"] }],
};

/** Column defaults from the migrations, applied on insert like Postgres does. */
const columnDefaults: Record<string, () => Row> = {
  creative_studio_pipeline_runs: () => ({
    status: "queued", attempt_count: 0, budget_reserved_usd: 0, worker_lease_id: null, worker_lease_expires_at: null,
    next_step_at: new Date().toISOString(), error_code: null, reasons: [], allow_fallback: false, max_attempts: 3,
  }),
  creative_studio_takes: () => ({
    job_id: null, raw_asset_id: null, final_asset_id: null, cover_asset_id: null, finish_job_id: null,
    check_job_id: null, stage: "generating", checks: null, verdict: "pending",
  }),
  creative_studio_jobs: () => ({
    provider_task_id: null, output_asset_id: null, error_code: null, cost_usd: null, gpu_seconds: null,
    submit_attempt_id: null, provider: "alibaba", seed: null,
  }),
  creative_studio_vision_jobs: () => ({ output_asset_ids: [], result: null, error_code: null, attempt_count: 0 }),
};

const violates = (name: string, rows: Row[], candidate: Row) => (uniqueKeys[name] ?? []).some(({ columns, where }) => (
  (!where || where(candidate)) && rows.some((row) => (
    row !== candidate && (!where || where(row)) && columns.every((column) => row[column] === candidate[column])
  ))
));

const readColumn = (row: Row, column: string) => {
  const [base, key] = column.split("->>");
  if (key === undefined) return row[base];
  const value = row[base]?.[key];
  return value === undefined || value === null ? null : String(value);
};

/** In-memory Supabase for creation route tests: PostgREST-style filters, unique keys and a storage bucket. */
export function creationsFakeSupabase() {
  const tables: Record<string, Row[]> = {};
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const table = (name: string) => (tables[name] ??= []);

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private operation: "select" | "update" | "insert" = "select";
    private patch: Row = {};
    private rows: Row[] = [];
    private mode: "many" | "maybeSingle" | "single" = "many";

    constructor(private readonly name: string) {}

    select() {
      return this;
    }
    insert(rows: Row | Row[]) {
      this.operation = "insert";
      this.rows = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
        ...(columnDefaults[this.name]?.() ?? {}),
        id: row.id ?? crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      }));
      return this;
    }
    update(patch: Row) {
      this.operation = "update";
      this.patch = patch;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((row) => readColumn(row, column) === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((row) => values.includes(readColumn(row, column)));
      return this;
    }
    order() {
      return this;
    }
    maybeSingle() {
      this.mode = "maybeSingle";
      return this;
    }
    single() {
      this.mode = "single";
      return this;
    }
    then<T>(resolve: (value: { data: any; error: any }) => T, reject?: (error: unknown) => T) {
      return Promise.resolve(this.run()).then(resolve, reject);
    }

    private shape(rows: Row[]) {
      const copies = rows.map((row) => structuredClone(row));
      if (this.mode === "many") return { data: copies, error: null };
      if (this.mode === "single" && copies.length !== 1) return { data: null, error: { message: "not one row" } };
      return { data: copies[0] ?? null, error: null };
    }

    private run() {
      if (this.operation === "insert") {
        for (const row of this.rows) {
          if (violates(this.name, table(this.name), row)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        table(this.name).push(...this.rows.map((row) => structuredClone(row)));
        return this.shape(this.rows);
      }
      const matched = table(this.name).filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "update") {
        const before = matched.map((row) => structuredClone(row));
        for (const row of matched) Object.assign(row, structuredClone(this.patch));
        if (matched.some((row) => violates(this.name, table(this.name), row))) {
          matched.forEach((row, index) => Object.assign(row, before[index]));
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
      }
      return this.shape(matched);
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, seconds: number) => ({
          data: { signedUrl: `https://storage.test/sign/${path}?expires=${seconds}` },
          error: null,
        }),
        createSignedUploadUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/upload/${path}?token=t`, path, token: "t" },
          error: null,
        }),
        list: async (folder: string, options: { search?: string } = {}) => ({
          data: [...objects.keys()]
            .filter((path) => path.startsWith(`${folder}/`))
            .map((path) => path.slice(folder.length + 1))
            .filter((name) => !name.includes("/") && name.includes(options.search ?? ""))
            .map((name) => ({ name })),
          error: null,
        }),
        download: async (path: string) => {
          const object = objects.get(path);
          return object
            ? { data: new Blob([new Uint8Array(object.bytes)], { type: object.contentType }), error: null }
            : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  };

  /** Stores the file as the browser would with the signed upload URL. */
  const uploadTo = (signedUrl: string, bytes: Buffer, contentType: string) => {
    const path = decodeURIComponent(new URL(signedUrl).pathname.replace(/^\/upload\//, ""));
    objects.set(path, { bytes, contentType });
    return path;
  };

  return { client, tables, objects, uploadTo };
}

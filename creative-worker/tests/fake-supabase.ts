type Row = Record<string, any>;

const ACTIVE_JOB_STATUSES = ["queued", "submitting", "submitted", "running", "downloading"];
const uniqueColumns: Record<string, string[]> = { creative_studio_assets: ["id", "object_path"] };

/** In-memory stand-in for the parts of supabase-js the worker uses, with the claim RPC's SQL semantics. */
export function fakeSupabase(tables: Record<string, Row[]>) {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const calls = { rpc: [] as string[], uploads: [] as string[] };
  const table = (name: string) => (tables[name] ??= []);

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private operation: "select" | "update" | "insert" = "select";
    private patch: Row = {};
    private rows: Row[] = [];
    private returning = false;
    private single = false;

    constructor(private readonly name: string) {}

    select() {
      if (this.operation === "select") return this;
      this.returning = true;
      return this;
    }
    update(patch: Row) {
      this.operation = "update";
      this.patch = patch;
      return this;
    }
    insert(rows: Row | Row[]) {
      this.operation = "insert";
      this.rows = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value);
      return this;
    }
    is(column: string, value: unknown) {
      this.filters.push((row) => (row[column] ?? null) === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((row) => values.includes(row[column]));
      return this;
    }
    order() {
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    then<T>(resolve: (value: { data: any; error: any }) => T, reject?: (error: unknown) => T) {
      return Promise.resolve(this.run()).then(resolve, reject);
    }

    private matching() {
      return table(this.name).filter((row) => this.filters.every((filter) => filter(row)));
    }

    private run() {
      if (this.operation === "insert") {
        for (const row of this.rows) {
          for (const column of uniqueColumns[this.name] ?? []) {
            if (table(this.name).some((existing) => existing[column] === row[column])) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
        }
        table(this.name).push(...this.rows.map((row) => ({ ...row })));
        return { data: this.returning ? this.rows : null, error: null };
      }
      if (this.operation === "update") {
        const matched = this.matching();
        for (const row of matched) Object.assign(row, this.patch);
        return { data: this.returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
      }
      const found = this.matching();
      return { data: this.single ? found[0] ?? null : found, error: null };
    }
  }

  const claimJob = (allowed: string[]) => {
    const now = Date.now();
    const job = table("creative_studio_jobs").find((row) => (
      ACTIVE_JOB_STATUSES.includes(row.status)
      && allowed.includes(row.provider)
      && Date.parse(row.next_poll_at) <= now
      && (!row.worker_lease_expires_at || Date.parse(row.worker_lease_expires_at) <= now)
    ));
    if (!job) return null;
    Object.assign(job, {
      status: job.status === "queued" ? "submitting" : job.status,
      worker_lease_id: crypto.randomUUID(),
      worker_lease_expires_at: new Date(now + 120_000).toISOString(),
      next_poll_at: new Date(now + 15_000).toISOString(),
      attempt_count: (job.attempt_count ?? 0) + 1,
    });
    return { ...job };
  };

  const client = {
    from: (name: string) => new Query(name),
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.rpc.push(fn);
      if (fn === "claim_creative_studio_provider_job") {
        return { data: claimJob(args.allowed_providers as string[]), error: null };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null }),
        info: async (path: string) => {
          const object = objects.get(path);
          return object
            ? { data: { size: object.bytes.byteLength, contentType: object.contentType }, error: null }
            : { data: null, error: { message: "Object not found" } };
        },
        upload: async (path: string, bytes: Buffer, options: { contentType: string; upsert: boolean }) => {
          calls.uploads.push(path);
          if (objects.has(path) && !options.upsert) return { data: null, error: { message: "The resource already exists" } };
          objects.set(path, { bytes, contentType: options.contentType });
          return { data: { path }, error: null };
        },
      }),
    },
  };

  /** Lets the next tick claim every job right away, as if the poll interval and lease had passed. */
  const fastForward = () => {
    for (const job of table("creative_studio_jobs")) {
      job.next_poll_at = new Date(Date.now() - 1_000).toISOString();
      job.worker_lease_expires_at = null;
    }
  };

  return { client, tables, objects, calls, fastForward };
}

type Row = Record<string, any>;

const uniqueColumns: Record<string, string[]> = {
  creative_studio_assets: ["id", "object_path"],
  creative_studio_projects: ["id"],
};

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
          for (const column of uniqueColumns[this.name] ?? []) {
            if (table(this.name).some((existing) => existing[column] === row[column])) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
        }
        table(this.name).push(...this.rows.map((row) => structuredClone(row)));
        return this.shape(this.rows);
      }
      const matched = table(this.name).filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === "update") for (const row of matched) Object.assign(row, structuredClone(this.patch));
      return this.shape(matched);
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    storage: {
      from: () => ({
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

import type { CreationDocumentV2, CreationView, UploadCheckResult } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { CreationApiError, type CreationApi } from "./api";

/** In-memory creation API for tests and the development preview. Never imported by the production page. */

export type MockRouteContext = {
  getCreation: (id: string) => CreationView;
  /** Replaces a creation's document (as the server would) and returns the new view. */
  saveDocument: (id: string, document: CreationDocumentV2) => CreationView;
};
export type MockRoute = {
  method: "GET" | "POST" | "PUT";
  path: RegExp;
  handle: (match: RegExpMatchArray, body: unknown, context: MockRouteContext) => unknown | Promise<unknown>;
};

/** Endpoints the panels add to the mock: each panel registers its routes with one line (see motion/, model/). */
export const MOCK_ROUTES: MockRoute[] = [];

export type MeasuredImage = { width: number; height: number };

const measureInBrowser = async (file: Blob): Promise<MeasuredImage> => {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
};

/** A neutral placeholder for fixture assets that have no file (no real artwork in mocks). */
const placeholder = (label: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1122" height="1402" viewBox="0 0 1122 1402"><rect width="1122" height="1402" fill="#efece4"/><text x="561" y="701" font-family="Georgia" font-size="56" fill="#9a9a8e" text-anchor="middle">${label}</text></svg>`,
)}`;

/**
 * In-memory `CreationApi` seeded from T0's fixtures, for tests and the local preview. Uploaded files stay in the
 * browser. Checks are simulated from the measured sizes: different sizes or a non-PNG text layer are errors, as in
 * B2; a slide named "potty" returns the potty warnings fixture.
 */
export function createMockCreationApi(options: {
  seed?: boolean;
  measure?: (file: Blob) => Promise<MeasuredImage>;
  uploadDelayMs?: number;
  failUploadsFor?: (fileName: string) => boolean;
  objectUrl?: (file: Blob) => string;
  running?: () => Array<{projectId:string;slideId:string}>;
} = {}): CreationApi & { files: Map<string, File> } {
  const measure = options.measure ?? measureInBrowser;
  const objectUrl = options.objectUrl ?? ((file: Blob) => URL.createObjectURL(file));
  const creations = new Map<string, CreationView & { updatedAt: string }>();
  const files = new Map<string, File>();
  const pending = new Map<string, string>(); // signed URL -> asset id
  const assets = new Map<string, { file: File; size: MeasuredImage }>();
  if (options.seed) {
    const view = contractFixtures.creation;
    creations.set(view.id, { ...structuredClone(view), updatedAt: new Date().toISOString() });
  }
  const now = () => new Date().toISOString();
  const need = (id: string) => {
    const creation = creations.get(id);
    if (!creation) throw new CreationApiError(404, "carousel_not_found", "This creation could not be found.");
    return creation;
  };
  const store = (id: string, document: CreationDocumentV2) => {
    const current = need(id);
    const next = { id, revision: current.revision + 1, document: structuredClone(document), updatedAt: now() };
    creations.set(id, next);
    return { id: next.id, revision: next.revision, document: structuredClone(next.document) };
  };
  const view = (creation: CreationView) => ({ id: creation.id, revision: creation.revision, document: structuredClone(creation.document) });
  const checksFor = (name: string, background: MeasuredImage, text: { file: File; size: MeasuredImage } | null): UploadCheckResult => {
    if (text && (text.size.width !== background.width || text.size.height !== background.height)) {
      return { ok: false, items: [{ code: "size_mismatch", severity: "error", message:
        `The text layer is ${text.size.width}×${text.size.height} but the background is ${background.width}×${background.height}. Export both at the same size.` }] };
    }
    if (text && text.file.type !== "image/png") {
      return { ok: false, items: [{ code: "no_alpha", severity: "error", message: "The text layer must be a PNG with transparency." }] };
    }
    if (name.toLowerCase() === "potty") return structuredClone(contractFixtures.uploadChecksPotty);
    return { ok: true, items: [] };
  };
  return {
    files,
    async listCreations() {
      return [...creations.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((creation) => ({
          id: creation.id,
          name: creation.document.name,
          updatedAt: creation.updatedAt,
          slideCount: creation.document.slides.length,
          slidesInProgress: new Set(options.running?.().filter(run=>run.projectId===creation.id).map(run=>run.slideId)??[]).size,
          coverAssetId: creation.document.slides[0]?.layers.backgroundAssetId ?? null,
        }));
    },
    async getCreation(id) {
      return view(need(id));
    },
    async createCreation(name) {
      const id = crypto.randomUUID();
      const document = { ...structuredClone(contractFixtures.creation.document), name, slides: [] };
      creations.set(id, { id, revision: 0, document, updatedAt: now() });
      return view(need(id));
    },
    async saveCreation(id, revision, document) {
      if (need(id).revision !== revision) {
        throw new CreationApiError(409, "carousel_revision_conflict", "This creation changed somewhere else.");
      }
      return store(id, document);
    },
    async requestLayerUploads(_id, _slideId, upload) {
      const signed = (assetId: string) => {
        const signedUrl = `https://mock.storage/upload/${assetId}`;
        pending.set(signedUrl, assetId);
        return { assetId, signedUrl };
      };
      return { uploads: { background: signed(upload.background.assetId), ...(upload.text ? { text: signed(upload.text.assetId) } : {}) } };
    },
    async uploadFile(signedUrl, file, onProgress) {
      const assetId = pending.get(signedUrl);
      if (!assetId) throw new CreationApiError(400, "upload_failed", "This upload link has expired.");
      for (const fraction of [0.25, 0.6, 1]) {
        await new Promise((resolve) => setTimeout(resolve, options.uploadDelayMs ?? 0));
        if (options.failUploadsFor?.(file.name) && fraction > 0.5) {
          throw new CreationApiError(0, "upload_failed", "The connection dropped while uploading. Try again.");
        }
        onProgress(fraction);
      }
      files.set(assetId, file);
    },
    async finaliseLayers(id, slideId, finalise) {
      const creation = need(id);
      if (creation.revision !== finalise.revision) {
        throw new CreationApiError(409, "carousel_revision_conflict", "This creation changed somewhere else.");
      }
      const slide = creation.document.slides.find((candidate) => candidate.id === slideId);
      if (!slide) throw new CreationApiError(404, "slide_not_found", "This slide is not in the creation.");
      const load = async (assetId: string) => {
        const known = assets.get(assetId);
        if (known) return known;
        const file = files.get(assetId);
        if (!file) throw new CreationApiError(400, "layers_missing", "The layer upload is incomplete. Upload it again.");
        const entry = { file, size: await measure(file) };
        assets.set(assetId, entry);
        return entry;
      };
      const background = await load(finalise.background.assetId);
      const textId = finalise.text === undefined ? slide.layers.textAssetId : finalise.text?.assetId ?? null;
      const text = textId ? await load(textId) : null;
      const checks = checksFor(slide.name, background.size, text);
      const document = {
        ...creation.document,
        slides: creation.document.slides.map((candidate) => candidate.id !== slideId ? candidate : {
          ...candidate,
          width: background.size.width,
          height: background.size.height,
          layers: { backgroundAssetId: finalise.background.assetId, textAssetId: textId },
          checks,
        }),
      };
      return { creation: store(id, document), checks };
    },
    async fetchJson(path, init = {}) {
      const method = init.method ?? (init.body === undefined ? "GET" : "POST");
      const url = new URL(path, "https://mock.studio");
      for (const route of MOCK_ROUTES) {
        const match = route.method === method ? url.pathname.match(route.path) : null;
        if (match) {
          return structuredClone(await route.handle(match, init.body, {
            getCreation: (id) => view(need(id)),
            saveDocument: (id, document) => store(id, document),
          }));
        }
      }
      // The toolbar is present even when an isolated upload test doesn't load U2's model routes.
      if (method === "GET" && url.pathname === "/api/budget") return structuredClone(contractFixtures.budget);
      throw new CreationApiError(404, "not_found", `The mock has no route for ${method} ${url.pathname}.`);
    },
    async assetUrl(assetId) {
      const known = assets.get(assetId)?.file ?? files.get(assetId);
      return known ? objectUrl(known) : placeholder("Sample slide");
    },
  };
}

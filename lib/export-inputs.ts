import type { Asset, createStore } from "./store";

type Store = ReturnType<typeof createStore>;

export function validateExportInputs(db: Store, projectId: string, videoAssetIds: string[], overlayAssetId?: string) {
  if (!projectId || !db.getProject(projectId)) throw new Error("Project not found.");
  if (!videoAssetIds.length) throw new Error("Choose at least one completed local video asset to export.");
  const videos = videoAssetIds.map((assetId) => db.getAsset(assetId));
  if (videos.some((asset) => !asset || !asset.mime.startsWith("video/"))) throw new Error("Choose completed local video assets to export.");
  videos.forEach((asset) => assertProjectAccess(asset as Asset, projectId));

  let overlay: Asset | null = null;
  if (overlayAssetId) {
    overlay = db.getAsset(overlayAssetId);
    if (!overlay?.mime.startsWith("image/")) throw new Error("Typography overlay must be an image asset.");
    assertProjectAccess(overlay, projectId);
  }
  return { videos: videos as Asset[], overlay };
}

function assertProjectAccess(asset: Asset, projectId: string) {
  if (asset.projectId !== null && asset.projectId !== projectId) throw new Error("Export inputs must belong to the same project or be an explicit global asset.");
}

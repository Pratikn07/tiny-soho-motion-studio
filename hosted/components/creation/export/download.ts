import { runResponseSchema, type SlideV2, type TakeView } from "@/lib/contract";
import type { CreationApi } from "../api";
import { fetchRun } from "../takes/useRun";
export type SaveFile = (url: string, name: string) => Promise<void>;
const filename = (name: string) =>
  name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .slice(0, 90)
    .replace(/^-+|-+$/g, "") || "slide";
export const saveFile: SaveFile = async (url, name) => {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok)
    throw new Error(
      "The download couldn't be loaded. Try again for a fresh link.",
    );
  const blob = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = blob;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blob), 10000);
};
export async function chosenTake(
  api: CreationApi,
  slide: SlideV2,
): Promise<TakeView | null> {
  if (!slide.chosenTakeId) return null;
  // A chosen take can predate the latest run. Resolve its own run so regeneration never loses its downloads.
  const run = runResponseSchema.parse(
    await api.fetchJson(`/api/takes/${slide.chosenTakeId}/run`),
  ).run;
  if (run.slideId !== slide.id)
    throw new Error("This take doesn't belong to this slide.");
  return run.takes.find((take) => take.id === slide.chosenTakeId) ?? null;
}
async function saveTake(
  take: TakeView | undefined | null,
  kind: "clip" | "cover",
  name: string,
  save: SaveFile,
) {
  const url = kind === "clip" ? take?.finalVideoUrl : take?.coverUrl;
  if (!url) throw new Error("This take isn't ready to download yet.");
  if (!take?.urlsExpireAt || Date.parse(take.urlsExpireAt) <= Date.now() + 5000)
    throw new Error("The download link expired. Try again.");
  await save(
    url,
    kind === "clip" ? `${filename(name)}.mp4` : `${filename(name)}-cover.png`,
  );
}
export async function downloadTake(
  api: CreationApi,
  run: string,
  take: string,
  kind: "clip" | "cover",
  name: string,
  save: SaveFile = saveFile,
) {
  // Each click gets fresh owner-only signed URLs instead of reusing the preview's five-minute links.
  const fresh = await fetchRun(api, run);
  await saveTake(
    fresh.takes.find((item) => item.id === take),
    kind,
    name,
    save,
  );
}
export async function downloadChosen(
  api: CreationApi,
  slides: SlideV2[],
  save: SaveFile = saveFile,
) {
  const ordered = [...slides].sort((a, b) => a.order - b.order);
  for (let i = 0; i < ordered.length; i++) {
    const slide = ordered[i];
    if (!slide.chosenTakeId) continue;
    await saveTake(
      await chosenTake(api, slide),
      "clip",
      `${String(i + 1).padStart(2, "0")}-${slide.name}`,
      save,
    );
  }
}

import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { LAYER_ASSET_KINDS, creationDocumentV2Schema, type SlideV2 } from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

import { ReviewRunsRepository } from "./repository";
import { ReviewerError, reviewerFromEnv } from "./reviewers";

type Params = Promise<{ id: string; slideId: string }>;

/** Owner check, the slide from the creation document, and its layers downloaded from private storage. */
export async function openSlideReview(request: Request, params: Params) {
  const owner = await requireOwner(request);
  const ids = await params;
  const projectId = z.string().uuid().parse(ids.id);
  const slideId = z.string().uuid().parse(ids.slideId);
  const client = createServiceSupabaseClient();
  const studio = new StudioRepository(client, owner);
  const document = creationDocumentV2Schema.safeParse((await studio.getProject(projectId))?.carousel_document);
  if (!document.success) throw new StudioError(404, "project_not_found", "Creation was not found.");
  const slide = document.data.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new StudioError(404, "slide_not_found", "This slide is not in the creation.");
  if (!slide.layers.backgroundAssetId) {
    throw new StudioError(400, "layers_missing", "Upload this slide's background before asking for suggestions.");
  }

  const download = async (assetId: string, kind: string) => {
    const asset = await studio.getAsset(assetId);
    if (!asset || asset.project_id !== projectId || (asset.kind as string) !== kind) {
      throw new StudioError(400, "layers_invalid", "This slide's layers are missing. Upload them again.");
    }
    const { data, error } = await client.storage.from("creative-studio").download(asset.object_path);
    if (error || !data) throw new StudioError(502, "source_unavailable", "This slide's layers could not be read.");
    return Buffer.from(await data.arrayBuffer());
  };

  let reviewer;
  try {
    reviewer = reviewerFromEnv();
  } catch (error) {
    if (error instanceof ReviewerError) {
      throw new StudioError(503, "review_unavailable", "Suggestions aren't available right now. You can describe your own motion.");
    }
    throw error;
  }

  return {
    projectId,
    slideId,
    slide: slide as SlideV2,
    reviewer,
    runs: new ReviewRunsRepository(client, owner),
    background: () => download(slide.layers.backgroundAssetId!, LAYER_ASSET_KINDS.background),
    text: () => (slide.layers.textAssetId ? download(slide.layers.textAssetId, LAYER_ASSET_KINDS.text) : Promise.resolve(null)),
  };
}

/** Logged reason for a failed review: fixed codes only, never provider bodies or prompts. */
export const failureReason = (error: unknown) => (error instanceof Error ? error.message.slice(0, 80) : "unknown");

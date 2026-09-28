import { z } from "zod";
import sharp from "sharp";
import { requireOwner } from "@/lib/auth";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { analyzeCarousel } from "@/lib/carousel-analysis";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const input = z
      .object({ assetId: z.string().uuid() })
      .parse(await request.json());
    const client = createServiceSupabaseClient();
    const asset = await new StudioRepository(client, owner).getAsset(
      input.assetId,
    );
    if (!asset || asset.kind !== "source-image")
      throw new StudioError(
        404,
        "asset_not_found",
        "Source image was not found.",
      );
    if (!process.env.NVIDIA_API_KEY || !process.env.NVIDIA_VISION_MODEL)
      throw new StudioError(
        503,
        "analysis_not_configured",
        "Image analysis is not configured. Write a story and mark areas manually.",
      );
    const { data, error } = await client.storage
      .from("creative-studio")
      .download(asset.object_path);
    if (error || !data)
      throw new StudioError(
        502,
        "source_unavailable",
        "Source image could not be read.",
      );
    const bytes = await sharp(Buffer.from(await data.arrayBuffer()), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
    const analysis = await analyzeCarousel(
      `data:image/jpeg;base64,${bytes.toString("base64")}`,
      process.env,
      fetch,
      new URL(request.url).searchParams.get("inspect") === "1",
    );
    return Response.json({ analysis });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

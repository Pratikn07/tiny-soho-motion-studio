import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { imageUploadFinishSchema, imageUploadRequestSchema, ReelImageStore } from "@/lib/reel-images";
import { ReelsRepository } from "@/lib/reels";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

async function scope(request: Request, context: Context) {
  const owner = await requireOwner(request);
  const id = z.string().uuid().parse((await context.params).id);
  const client = createServiceSupabaseClient();
  return { id, repo: new ReelsRepository(client as never, owner.userId), store: new ReelImageStore(client as never, owner.userId, id) };
}

/** Starts an upload: checks the file is one the storyboard asks for and returns a one-time upload URL. */
export async function POST(request: Request, context: Context) {
  try {
    const { id, repo, store } = await scope(request, context);
    const input = imageUploadRequestSchema.parse(await request.json());
    repo.imageToMake((await repo.get(id)).document, input.file);
    return Response.json(await store.startUpload(input));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Finishes an upload: checks the image, records it on the reel (replacing an earlier one) and queues the Mac's look. */
export async function PUT(request: Request, context: Context) {
  try {
    const { id, repo, store } = await scope(request, context);
    const input = imageUploadFinishSchema.parse(await request.json());
    const image = repo.imageToMake((await repo.get(id)).document, input.file);
    const upload = await store.finishUpload(input.file, input.uploadId, image);
    const { replaced } = await repo.recordUpload(id, upload);
    if (replaced && replaced !== upload.objectPath) await store.remove([replaced]);
    return Response.json(await store.withUrls(await repo.get(id)));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Removes an uploaded image and its file. */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id, repo, store } = await scope(request, context);
    const file = z.string().min(1).max(80).parse(new URL(request.url).searchParams.get("file"));
    const removed = await repo.removeUpload(id, file);
    if (removed) await store.remove([removed]);
    return Response.json(await store.withUrls(await repo.get(id)));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

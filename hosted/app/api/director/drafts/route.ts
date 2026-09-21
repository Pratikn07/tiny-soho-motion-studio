import { requireOwner } from "@/lib/auth";
import { createDirectorDraft, createDirectorDraftSchema, publicDirectorRequest } from "@/lib/director";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = createDirectorDraftSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new StudioError(400, "invalid_director_draft", "Director draft request is invalid.");
    }
    const repository = new StudioRepository(createServiceSupabaseClient(), owner);
    const directorRequest = await createDirectorDraft(parsed.data, repository);
    return Response.json({ request: publicDirectorRequest(directorRequest) }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

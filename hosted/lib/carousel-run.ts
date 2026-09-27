import { z } from "zod";
import { requireOwner } from "./auth";
import { StudioRepository } from "./repository";
import { createServiceSupabaseClient } from "./supabase-server";
import { StudioError } from "./errors";
import { carouselDocumentSchema } from "./carousel";
export async function savedRun(request: Request, projectId: string) {
  const owner = await requireOwner(request),
    input = z
      .object({ slideId: z.string(), runId: z.string().uuid() })
      .parse(await request.json());
  const repo = new StudioRepository(createServiceSupabaseClient(), owner),
    project = await repo.getProject(z.string().uuid().parse(projectId));
  if (!project)
    throw new StudioError(404, "project_not_found", "Project was not found.");
  const document = carouselDocumentSchema.parse(project.carousel_document);
  const slide = document.slides.find((s) => s.id === input.slideId);
  if (!slide?.run || slide.run.id !== input.runId)
    throw new StudioError(
      409,
      "run_not_saved",
      "Save this generation plan before continuing.",
    );
  return { repo, project, slide, run: slide.run };
}
export function internalRequest(request: Request, body: unknown) {
  return new Request(request.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: request.headers.get("Authorization") ?? "",
    },
    body: JSON.stringify(body),
  });
}

import { createCreationRequestSchema, type CreationListResponse } from "@/lib/contract";
import { newCreationDocument } from "@/lib/creations";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";

export async function GET(request: Request) {
  try {
    const { repo } = await openCreations(request);
    const body: CreationListResponse = { creations: await repo.listCreations() };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { repo } = await openCreations(request);
    const input = createCreationRequestSchema.parse(await request.json());
    const creation = await repo.createCreation(newCreationDocument(input.name));
    return Response.json(creation, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

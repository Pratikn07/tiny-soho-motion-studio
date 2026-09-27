import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    await requireOwner(request);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

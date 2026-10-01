import { budgetView, monthlyCapUsd } from "@/lib/budget";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";

export async function GET(request: Request) {
  try {
    const { owner, client } = await openCreations(request);
    return Response.json(await budgetView(client, owner, monthlyCapUsd()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

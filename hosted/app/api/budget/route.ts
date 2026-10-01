import { modalBillingFor } from "@/lib/modal-billing";
import { budgetView, monthlyCapUsd } from "@/lib/budget";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";

export async function GET(request: Request) {
  try {
    const { owner, client } = await openCreations(request);
    const budget = await budgetView(client, owner, monthlyCapUsd());
    return Response.json({ ...budget, modalBilling: await modalBillingFor(budget.month) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

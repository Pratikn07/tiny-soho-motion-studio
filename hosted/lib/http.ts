import { StudioError } from "@/lib/errors";

export function routeErrorResponse(error: unknown) {
  if (error instanceof StudioError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  return Response.json(
    { error: { code: "studio_internal_error", message: "Studio service is temporarily unavailable." } },
    { status: 500 },
  );
}

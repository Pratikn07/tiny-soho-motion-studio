import { NextRequest, NextResponse } from "next/server";

export function localOnly(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin");
  if (!/^127\.0\.0\.1(?::\d+)?$|^localhost(?::\d+)?$/.test(host)) return NextResponse.json({ error: "Local requests only." }, { status: 403 });
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return NextResponse.json({ error: "Invalid local origin." }, { status: 403 });
  return null;
}

export function errorResponse(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 400 }); }

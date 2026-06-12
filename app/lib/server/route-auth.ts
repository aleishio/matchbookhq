import { NextResponse } from "next/server";

export function requireServerActionSecret(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const expected = env.LUMA_SYNC_SECRET || env.CRON_SECRET || env.WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "server_action_secret_missing", message: "A server action secret is required for this endpoint." },
      { status: 500 }
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-cron-secret") ?? "";

  if (bearer === expected || headerSecret === expected) return null;

  return NextResponse.json(
    { error: "unauthorized", message: "Invalid server action secret." },
    { status: 401 }
  );
}

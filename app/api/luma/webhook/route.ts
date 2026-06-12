import { NextResponse } from "next/server";

import {
  createSupabaseLumaWebhookStoreFromEnv,
  handleLumaWebhook,
  LumaWebhookSignatureError
} from "@/app/lib/luma/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.LUMA_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "luma_webhook_secret_missing", message: "LUMA_WEBHOOK_SECRET is required." },
      { status: 500 }
    );
  }

  const rawBody = await request.text();

  try {
    const result = await handleLumaWebhook({
      rawBody,
      headers: request.headers,
      secret,
      store: createSupabaseLumaWebhookStoreFromEnv()
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LumaWebhookSignatureError) {
      return NextResponse.json(
        { error: "invalid_luma_webhook_signature", message: error.message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "luma_webhook_error", message: "Unable to process Lu.ma webhook." },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

import {
  createResendReceivingClientFromEnv,
  createSupabaseResendWebhookStoreFromEnv,
  handleResendWebhook,
  ResendWebhookProcessingError,
  ResendWebhookSignatureError
} from "@/app/lib/resend/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "resend_webhook_secret_missing", message: "RESEND_WEBHOOK_SECRET is required." },
      { status: 500 }
    );
  }

  const rawBody = await request.text();

  try {
    const result = await handleResendWebhook({
      rawBody,
      headers: request.headers,
      secret,
      apiKey: process.env.RESEND_API_KEY,
      store: createSupabaseResendWebhookStoreFromEnv(),
      receivingClient: process.env.RESEND_API_KEY?.trim()
        ? createResendReceivingClientFromEnv()
        : undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ResendWebhookSignatureError) {
      return NextResponse.json(
        { error: "invalid_resend_webhook_signature", message: error.message },
        { status: 401 }
      );
    }

    if (error instanceof ResendWebhookProcessingError) {
      return NextResponse.json(
        { error: "resend_webhook_processing_error", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "resend_webhook_error", message: "Unable to process Resend webhook." },
      { status: 500 }
    );
  }
}

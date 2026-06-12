import { NextResponse } from "next/server";

import {
  EventPrepRepositoryError,
  listEventPrepEvents
} from "@/app/lib/event-prep-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await listEventPrepEvents();
    return NextResponse.json({ events });
  } catch (error) {
    return eventPrepErrorResponse(error);
  }
}

function eventPrepErrorResponse(error: unknown) {
  if (error instanceof EventPrepRepositoryError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    { error: "event_prep_events_api_error", message: "Unable to load event prep events." },
    { status: 500 }
  );
}

import { NextResponse } from "next/server";

import {
  boundedEventPrepInteger,
  EventPrepRepositoryError,
  listEventPrepFounders,
  normalizeEventPrepLens
} from "@/app/lib/event-prep-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const response = await listEventPrepFounders({
      eventId: url.searchParams.get("eventId") ?? undefined,
      lens: normalizeEventPrepLens(url.searchParams.get("lens"), "all"),
      search: url.searchParams.get("search") ?? "",
      page: boundedEventPrepInteger(url.searchParams.get("page"), 1, 1, Number.MAX_SAFE_INTEGER),
      pageSize: boundedEventPrepInteger(url.searchParams.get("pageSize"), 25, 1, 100)
    });

    return NextResponse.json(response);
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
    { error: "event_prep_api_error", message: "Unable to load event prep founders." },
    { status: 500 }
  );
}

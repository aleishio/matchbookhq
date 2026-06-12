import type { Metadata } from "next";
import { EventPrepApp } from "@/components/EventPrepApp";
import {
  listEventPrepEvents,
  listEventPrepFounders
} from "./lib/event-prep-repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Event Prep | YC OS Events",
  description: "Founder matching, notes, and intro prep for YC event rooms."
};

export default async function Home() {
  const events = await listEventPrepEvents();
  const data = await listEventPrepFounders({
    eventId: events[0]?.id,
    pageSize: 25
  });

  return <EventPrepApp data={data} events={events} />;
}

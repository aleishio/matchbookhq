import type { Metadata } from "next";
import { EventApprovalsApp } from "@/components/EventApprovalsApp";
import {
  listApprovalEvents,
  listEventApprovals
} from "../lib/event-approvals-repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Approvals | YC OS Events",
  description: "Review Lu.ma applications, source comparisons, and approval queues for YC events."
};

export default async function ApprovalsPage() {
  const events = await listApprovalEvents();
  const initialList = events[0]
    ? await listEventApprovals({
      eventId: events[0].id,
      queue: "all",
      segment: "all",
      page: 1,
      pageSize: 25
    })
    : null;

  return <EventApprovalsApp data={{ events, initialList }} />;
}

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { clearLocalApprovalDecisionsForTests } from "../app/lib/event-approval-decisions.ts";
import {
  createBulkApprovalOperation,
  listEventApprovals
} from "../app/lib/event-approvals-repository.ts";
import { getEventPrepData } from "../app/lib/event-prep-data.ts";

beforeEach(() => {
  clearLocalApprovalDecisionsForTests();
});

test("uses the sanitized real Lu.ma event for focused event prep", async () => {
  const data = await getEventPrepData();

  assert.equal(data.event.id, "dogpatch-founder-breakfast");
  assert.equal(data.event.title, "Dogpatch Founder Breakfast");
  assert.equal(data.event.source, "Lu.ma API sanitized fixture");
  assert.equal(data.event.attendeeCount, 5);
  assert.equal(data.founders.length, 5);
  assert.deepEqual(
    data.founders.map((founder) => founder.name).sort(),
    ["Matthew Xu", "Paulina Xu", "Richard Zhou", "Serafim Korablev", "Sergey Bunas"]
  );
  assert.ok(data.founders.every((founder) => founder.photoUrl));
});

test("includes locally approved Dogpatch applicants in event prep", async () => {
  const rejected = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "rejected",
    pageSize: 1
  });
  const applicant = rejected.applications[0];

  await createBulkApprovalOperation({
    eventId: "dogpatch-founder-breakfast",
    action: "approve",
    applicationIds: [applicant.id],
    actorName: "Ops Manager"
  });

  const data = await getEventPrepData();

  assert.equal(data.event.id, "dogpatch-founder-breakfast");
  assert.equal(data.event.attendeeCount, 6);
  assert.equal(data.founders.length, 6);
  assert.ok(data.founders.some((founder) => founder.id === applicant.founderId));
});

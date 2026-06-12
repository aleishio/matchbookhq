import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { POST } from "../app/api/events/[eventId]/approvals/bulk/route.ts";
import { clearLocalApprovalDecisionsForTests } from "../app/lib/event-approval-decisions.ts";
import { listEventApprovals } from "../app/lib/event-approvals-repository.ts";

beforeEach(() => {
  clearLocalApprovalDecisionsForTests();
});

test("bulk approval route accepts custom clarification email copy", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "needs_info",
    segment: "possible_yc",
    pageSize: 1
  });
  const response = await POST(
    new Request("http://localhost/api/events/yc-founder-mixer/approvals/bulk", {
      method: "POST",
      body: JSON.stringify({
        action: "send_info",
        applicationIds: [list.applications[0].id],
        actorName: "Community",
        clarificationEmail: {
          subject: "Confirming your YC event details",
          body: "Please confirm your YC company, batch, role, and YC-connected email."
        }
      })
    }),
    { params: Promise.resolve({ eventId: "yc-founder-mixer" }) }
  );

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.appliedCount, 1);
  assert.equal(payload.jobs[0].type, "clarification_email");
  assert.equal(payload.jobs[0].subject, "Confirming your YC event details");
  assert.equal(payload.jobs[0].preview, "Please confirm your YC company, batch, role, and YC-connected email.");
});

test("bulk approval route skips immediate provider sync for local fixture operations", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "ready",
    segment: "yc_founders",
    pageSize: 1
  });
  const response = await POST(
    new Request("http://localhost/api/events/yc-founder-mixer/approvals/bulk", {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        applicationIds: [list.applications[0].id],
        actorName: "Community"
      })
    }),
    { params: Promise.resolve({ eventId: "yc-founder-mixer" }) }
  );

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.appliedCount, 1);
  assert.equal(payload.writebackSync.status, "skipped");
});

test("bulk approval route rejects overlong custom clarification email copy", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "needs_info",
    segment: "possible_yc",
    pageSize: 1
  });
  const response = await POST(
    new Request("http://localhost/api/events/yc-founder-mixer/approvals/bulk", {
      method: "POST",
      body: JSON.stringify({
        action: "send_info",
        applicationIds: [list.applications[0].id],
        clarificationEmail: {
          subject: "Confirming your YC event details",
          body: "x".repeat(2001)
        }
      })
    }),
    { params: Promise.resolve({ eventId: "yc-founder-mixer" }) }
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_clarification_email");
});

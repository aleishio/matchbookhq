import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createBulkApprovalOperation,
  EventApprovalsRepositoryError,
  getApprovalDossier,
  listApprovalEvents,
  listEventApprovals
} from "../app/lib/event-approvals-repository.ts";
import { clearLocalApprovalDecisionsForTests } from "../app/lib/event-approval-decisions.ts";

beforeEach(() => {
  clearLocalApprovalDecisionsForTests();
});

test("lists Lu.ma approval events through the backend contract", async () => {
  const events = await listApprovalEvents();

  assert.equal(events.length, 4);
  assert.equal(events[0].id, "ai-infra-office-hours");
  assert.equal(events[1].id, "dogpatch-founder-breakfast");
  assert.equal(events[1].source, "Lu.ma API sanitized fixture");
});

test("lists filtered approval queues with API-facing snake case filters", async () => {
  const result = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "ready",
    segment: "yc_founders",
    page: 1,
    pageSize: 30
  });

  assert.equal(result.event.id, "yc-founder-mixer");
  assert.equal(result.total, 120);
  assert.equal(result.applications.length, 30);
  assert.equal(result.counts.ready, 120);
  assert.equal(result.counts.needs_info, 214);
  assert.equal(result.segmentCounts.yc_founders, 120);
  assert.equal(result.query.segment, "yc_founders");
});

test("opens an approval dossier with source comparisons and Lu.ma payload", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "manual",
    segment: "investors",
    pageSize: 1
  });
  const dossier = await getApprovalDossier(list.applications[0].id);

  assert.equal(dossier.event.id, "yc-founder-mixer");
  assert.equal(dossier.application.id, list.applications[0].id);
  assert.ok(dossier.lumaPayload.guestId.startsWith("guest_yc-founder-mixer"));
  assert.equal(
    dossier.sourceComparisons.find((comparison) => comparison.field === "network")?.result,
    "partial"
  );
  assert.equal(dossier.aiRecommendation.decision, "manual");
});

test("filters approval queues by AI recommendation without making the decision authoritative", async () => {
  const result = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "awaiting_reply",
    aiDecision: "approve",
    pageSize: 50
  });

  assert.ok(result.total > 0);
  assert.ok(result.applications.every((application) => application.aiRecommendation.decision === "approve"));
  assert.ok(result.applications.every((application) => application.status === "awaitingReply"));
});

test("creates a user-triggered bulk approval operation for all ready filtered rows", async () => {
  const result = await createBulkApprovalOperation({
    eventId: "yc-founder-mixer",
    action: "approve",
    query: {
      queue: "ready",
      segment: "yc_founders",
      search: ""
    },
    actorName: "Ops Manager"
  });

  assert.match(result.operationId, /^approval_bulk_/);
  assert.equal(result.requestedCount, 120);
  assert.equal(result.appliedCount, 120);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.applications[0].status, "approved");
  assert.equal(result.jobs.length, 120);
  assert.equal(result.jobs[0].type, "luma_writeback");
  assert.deepEqual(result.jobs[0].payload.status, "approved");
});

test("queues clarification email jobs for needs-info selections", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "needs_info",
    segment: "possible_yc",
    pageSize: 2
  });
  const result = await createBulkApprovalOperation({
    eventId: "yc-founder-mixer",
    action: "send_info",
    applicationIds: list.applications.map((application) => application.id),
    actorName: "Community"
  });

  assert.equal(result.requestedCount, 2);
  assert.equal(result.appliedCount, 2);
  assert.equal(result.applications[0].status, "awaitingReply");
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].type, "clarification_email");
  assert.equal(result.jobs[0].provider, "resend");
});

test("queues user-authored clarification email copy without changing approval authority", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "needs_info",
    segment: "possible_yc",
    pageSize: 1
  });
  const result = await createBulkApprovalOperation({
    eventId: "yc-founder-mixer",
    action: "send_info",
    applicationIds: [list.applications[0].id],
    actorName: "Community",
    clarificationEmail: {
      subject: "Confirming your YC founder details",
      body: "Could you confirm your YC company, batch, role, and mapped YC email?"
    }
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.applications[0].status, "awaitingReply");
  const job = result.jobs[0];
  assert.equal(job.type, "clarification_email");
  if (job.type !== "clarification_email") throw new Error("expected clarification email job");
  assert.equal(job.subject, "Confirming your YC founder details");
  assert.equal(job.preview, "Could you confirm your YC company, batch, role, and mapped YC email?");
  assert.equal(job.payload.custom_copy, "true");
  assert.equal(job.payload.body, "Could you confirm your YC company, batch, role, and mapped YC email?");
});

test("queues clarification email jobs from approved applications", async () => {
  const list = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "approved",
    pageSize: 1
  });
  const result = await createBulkApprovalOperation({
    eventId: "dogpatch-founder-breakfast",
    action: "send_info",
    applicationIds: [list.applications[0].id],
    actorName: "Community"
  });

  assert.equal(result.requestedCount, 1);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.applications[0].status, "awaitingReply");
  const job = result.jobs[0];
  assert.equal(job.type, "clarification_email");
  if (job.type !== "clarification_email") throw new Error("expected clarification email job");
  assert.equal(job.provider, "resend");
});

test("maps YC OS rejection to Lu.ma declined writeback jobs", async () => {
  const list = await listEventApprovals({
    eventId: "yc-founder-mixer",
    queue: "manual",
    pageSize: 1
  });
  const result = await createBulkApprovalOperation({
    eventId: "yc-founder-mixer",
    action: "reject",
    applicationIds: [list.applications[0].id]
  });

  assert.equal(result.applications[0].status, "rejected");
  const job = result.jobs[0];
  assert.equal(job.type, "luma_writeback");
  if (job.type !== "luma_writeback") throw new Error("expected Lu.ma writeback job");
  assert.equal(job.targetStatus, "declined");
  assert.equal(job.payload.status, "declined");
});

test("approves rejected applications when an operator reverses a decision", async () => {
  const list = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "rejected",
    pageSize: 1
  });
  const result = await createBulkApprovalOperation({
    eventId: "dogpatch-founder-breakfast",
    action: "approve",
    applicationIds: [list.applications[0].id],
    actorName: "Ops Manager"
  });

  assert.equal(result.requestedCount, 1);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.applications[0].status, "approved");
  const job = result.jobs[0];
  assert.equal(job.type, "luma_writeback");
  if (job.type !== "luma_writeback") throw new Error("expected Lu.ma writeback job");
  assert.equal(job.targetStatus, "approved");
  assert.equal(job.payload.status, "approved");
});

test("rejects approved applications when an operator reverses a decision", async () => {
  const list = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "approved",
    pageSize: 1
  });
  const result = await createBulkApprovalOperation({
    eventId: "dogpatch-founder-breakfast",
    action: "reject",
    applicationIds: [list.applications[0].id],
    actorName: "Ops Manager"
  });

  assert.equal(result.requestedCount, 1);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.applications[0].status, "rejected");
  const job = result.jobs[0];
  assert.equal(job.type, "luma_writeback");
  if (job.type !== "luma_writeback") throw new Error("expected Lu.ma writeback job");
  assert.equal(job.targetStatus, "declined");
  assert.equal(job.payload.status, "declined");
});

test("persists local Dogpatch approval decisions across queue refetches", async () => {
  const rejectedBefore = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "rejected",
    pageSize: 1
  });
  const applicationId = rejectedBefore.applications[0].id;

  await createBulkApprovalOperation({
    eventId: "dogpatch-founder-breakfast",
    action: "approve",
    applicationIds: [applicationId],
    actorName: "Ops Manager"
  });

  const rejectedAfter = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "rejected",
    pageSize: 25
  });
  const approvedAfter = await listEventApprovals({
    eventId: "dogpatch-founder-breakfast",
    queue: "approved",
    pageSize: 25
  });

  assert.equal(rejectedAfter.applications.some((application) => application.id === applicationId), false);
  assert.equal(approvedAfter.applications.some((application) => application.id === applicationId), true);
  assert.equal(approvedAfter.total, 3);
});

test("requires an explicit bulk scope", async () => {
  await assert.rejects(
    () =>
      createBulkApprovalOperation({
        eventId: "yc-founder-mixer",
        action: "approve"
      }),
    (error) => {
      assert.ok(error instanceof EventApprovalsRepositoryError);
      assert.equal(error.code, "missing_bulk_scope");
      return true;
    }
  );
});

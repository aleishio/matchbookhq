import assert from "node:assert/strict";
import test from "node:test";

import { getEventApprovalsData } from "../app/lib/event-approvals-data.ts";
import {
  canApprove,
  canReject,
  canSendInfo,
  transitionApplication
} from "../app/lib/event-approvals-state.ts";

test("approves a ready application and shows the Lu.ma sync as done", async () => {
  const data = await getEventApprovalsData();
  const readyApplication = data.applications.find((application) => application.status === "ready");

  assert.ok(readyApplication);

  const approved = transitionApplication(readyApplication, "approved", "Approved in test.");

  assert.equal(approved.status, "approved");
  assert.equal(approved.matchConfidence, 100);
  assert.equal(approved.primaryAction, "none");
  assert.equal(approved.lumaStatus, "Approved in Lu.ma");
  assert.deepEqual(approved.evidence[0], {
    label: "User decision",
    value: "Approved in test.",
    tone: "ok"
  });
  assert.equal(readyApplication.status, "ready");
});

test("rejects an application without mutating the source record", async () => {
  const data = await getEventApprovalsData();
  const manualApplication = data.applications.find((application) => application.status === "manual");

  assert.ok(manualApplication);

  const rejected = transitionApplication(manualApplication, "rejected", "Rejected in test.");

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.matchConfidence, 0);
  assert.equal(rejected.primaryAction, "none");
  assert.match(rejected.rule, /user rejected/);
  assert.deepEqual(rejected.evidence[0], {
    label: "User decision",
    value: "Rejected in test.",
    tone: "warn"
  });
  assert.equal(manualApplication.status, "manual");
});

test("queues clarification emails for uncertain applications", async () => {
  const data = await getEventApprovalsData();
  const needsInfoApplication = data.applications.find((application) => application.status === "needsInfo");

  assert.ok(needsInfoApplication);
  assert.equal(canSendInfo(needsInfoApplication), true);

  const awaiting = transitionApplication(
    needsInfoApplication,
    "awaitingReply",
    "Clarification email queued from test."
  );

  assert.equal(awaiting.status, "awaitingReply");
  assert.equal(awaiting.primaryAction, "manualReview");
  assert.match(awaiting.rule, /clarification email sent/);
  assert.equal(awaiting.audit[0], "Clarification email queued from test.");
});

test("any non-awaiting applicant with email can receive clarification requests", async () => {
  const data = await getEventApprovalsData();
  const byStatus = new Map(data.applications.map((application) => [application.status, application]));

  assert.equal(canSendInfo(byStatus.get("needsInfo")!), true);
  assert.equal(canSendInfo(byStatus.get("manual")!), true);
  assert.equal(canSendInfo(byStatus.get("ready")!), true);
  assert.equal(canSendInfo(byStatus.get("awaitingReply")!), false);
  assert.equal(canSendInfo(byStatus.get("waitlist")!), true);
});

test("approval can override every non-approved application state", async () => {
  const data = await getEventApprovalsData();
  const readyApplication = data.applications.find((application) => application.status === "ready");
  const needsInfoApplication = data.applications.find((application) => application.status === "needsInfo");
  const awaitingReplyApplication = data.applications.find((application) => application.status === "awaitingReply");
  const manualApplication = data.applications.find((application) => application.status === "manual");
  const waitlistApplication = data.applications.find((application) => application.status === "waitlist");

  assert.ok(readyApplication);
  assert.ok(needsInfoApplication);
  assert.ok(awaitingReplyApplication);
  assert.ok(manualApplication);
  assert.ok(waitlistApplication);
  assert.equal(canApprove(readyApplication), true);
  assert.equal(canApprove(needsInfoApplication), true);
  assert.equal(canApprove(awaitingReplyApplication), true);
  assert.equal(canApprove(manualApplication), true);
  assert.equal(canApprove(waitlistApplication), true);
  assert.equal(canApprove(transitionApplication(readyApplication, "approved", "Approved in test.")), false);
  assert.equal(canApprove(transitionApplication(readyApplication, "rejected", "Rejected in test.")), true);
});

test("bulk rejection only skips already rejected applications", async () => {
  const data = await getEventApprovalsData();
  const readyApplication = data.applications.find((application) => application.status === "ready");

  assert.ok(readyApplication);
  assert.equal(canReject(readyApplication), true);
  assert.equal(canReject(transitionApplication(readyApplication, "approved", "Approved in test.")), true);
  assert.equal(canReject(transitionApplication(readyApplication, "rejected", "Rejected in test.")), false);
});

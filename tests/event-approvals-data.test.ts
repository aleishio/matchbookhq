import assert from "node:assert/strict";
import test from "node:test";

import {
  getEventApprovalsData,
  summarizeApprovalStatuses
} from "../app/lib/event-approvals-data.ts";
import {
  APPROVAL_SEGMENT_FILTERS,
  approvalSegmentLabelFor,
  filterApprovalApplications,
  summarizeApprovalSegments
} from "../app/lib/event-approvals-filters.ts";

test("loads all Lu.ma events into the approval portal", async () => {
  const data = await getEventApprovalsData();

  assert.equal(data.events.length, 4);
  assert.deepEqual(
    data.events.map((event) => event.id),
    ["ai-infra-office-hours", "dogpatch-founder-breakfast", "yc-founder-mixer", "founder-dinner"]
  );
  assert.equal(data.applications.length, 742);
  assert.ok(data.events.every((event) => event.url?.startsWith("https://luma.com/")));
});

test("builds the YC Founder Mixer approval distribution from the product workflow", async () => {
  const data = await getEventApprovalsData();
  const mixerApplications = data.applications.filter((application) => application.eventId === "yc-founder-mixer");
  const counts = summarizeApprovalStatuses(mixerApplications);

  assert.equal(mixerApplications.length, 600);
  assert.equal(data.events.find((event) => event.id === "yc-founder-mixer")?.seats, 150);
  assert.equal(counts.ready, 120);
  assert.equal(counts.needsInfo, 214);
  assert.equal(counts.awaitingReply, 66);
  assert.equal(counts.manual, 140);
  assert.equal(counts.waitlist, 60);
  assert.equal(counts.approved, 0);
  assert.equal(counts.rejected, 0);
});

test("marks verified applicants for user-triggered approval without auto rejecting anyone", async () => {
  const data = await getEventApprovalsData();
  const mixerApplications = data.applications.filter((application) => application.eventId === "yc-founder-mixer");
  const readyApplications = mixerApplications.filter((application) => application.status === "ready");
  const selectedDefaults = mixerApplications.filter((application) => application.selectedDefault);
  const rejectedApplications = mixerApplications.filter((application) => application.status === "rejected");

  assert.equal(readyApplications.length, 120);
  assert.ok(readyApplications.every((application) => application.primaryAction === "approve"));
  assert.ok(readyApplications.every((application) => application.matchConfidence >= 94));
  assert.equal(selectedDefaults.length, 4);
  assert.equal(rejectedApplications.length, 0);
});

test("uses the events subdomain for clarification requests", async () => {
  const data = await getEventApprovalsData();
  const needsInfoApplication = data.applications.find((application) => application.status === "needsInfo");

  assert.ok(needsInfoApplication?.clarificationRequest);
  assert.equal(needsInfoApplication.clarificationRequest.sentFrom, "events@events.ycombinator.com");
  assert.match(needsInfoApplication.clarificationRequest.subject, /Confirming your YC details/);
});

test("includes the manual-review example-domain applicant for email testing", async () => {
  const data = await getEventApprovalsData();
  const application = data.applications.find((item) => item.email === "manual-review@example.com");

  assert.ok(application);
  assert.equal(application.eventId, "yc-founder-mixer");
  assert.equal(application.name, "Aleix Ordeig");
  assert.equal(application.status, "needsInfo");
  assert.equal(application.primaryAction, "sendInfo");
});

test("preserves Lu.ma fields, source comparisons, and AI recommendations on each row", async () => {
  const data = await getEventApprovalsData();
  const readyApplication = data.applications.find((application) => application.status === "ready");
  const needsInfoApplication = data.applications.find((application) => application.status === "needsInfo");

  assert.ok(readyApplication);
  assert.equal(readyApplication.lumaPayload.rawFields.imported_from_luma, true);
  assert.equal(readyApplication.lumaPayload.registrationAnswers["YC company"], readyApplication.companyName);
  assert.equal(
    readyApplication.sourceComparisons.find((comparison) => comparison.field === "email")?.result,
    "match"
  );
  assert.equal(readyApplication.aiRecommendation.decision, "approve");
  assert.ok(readyApplication.aiRecommendation.confidence >= 90);

  assert.ok(needsInfoApplication);
  assert.equal(needsInfoApplication.aiRecommendation.decision, "send_info");
  assert.equal(
    needsInfoApplication.sourceComparisons.find((comparison) => comparison.field === "phone")?.result,
    "missing"
  );
});

test("segments event applicants by YC and network review buckets", async () => {
  const data = await getEventApprovalsData();
  const mixerApplications = data.applications.filter((application) => application.eventId === "yc-founder-mixer");
  const counts = summarizeApprovalSegments(mixerApplications);

  assert.equal(counts.ycFounders, 180);
  assert.equal(counts.possibleYc, 214);
  assert.equal(counts.unmapped, 66);
  assert.equal(counts.network, 93);
  assert.equal(counts.capacity, 60);
  assert.ok(counts.investors > 0);
});

test("filters the current queue by operator segment", async () => {
  const data = await getEventApprovalsData();
  const mixerApplications = data.applications.filter((application) => application.eventId === "yc-founder-mixer");
  const readyFounders = filterApprovalApplications(mixerApplications, "ready", "ycFounders", "");
  const investorManual = filterApprovalApplications(mixerApplications, "manual", "investors", "");
  const possibleYc = filterApprovalApplications(mixerApplications, "needsInfo", "possibleYc", "");
  const personalEmailMatches = filterApprovalApplications(mixerApplications, "needsInfo", "all", "personal email");

  assert.equal(readyFounders.length, 120);
  assert.ok(investorManual.every((application) => approvalSegmentLabelFor(application) === "Investor"));
  assert.equal(possibleYc.length, 214);
  assert.equal(personalEmailMatches.length, 214);
});

test("keeps review reasons out of the applicant type filter", () => {
  assert.deepEqual(
    APPROVAL_SEGMENT_FILTERS.map((segment) => segment.id),
    ["all", "ycFounders", "investors", "network", "unmapped"]
  );
});

test("uses the sanitized real Lu.ma event fixture without storing private attendee fields", async () => {
  const data = await getEventApprovalsData();
  const event = data.events.find((item) => item.id === "dogpatch-founder-breakfast");
  const applications = data.applications.filter((application) => application.eventId === "dogpatch-founder-breakfast");
  const counts = summarizeApprovalStatuses(applications);

  assert.ok(event);
  assert.equal(event.lumaApiId, "evt-YQNWbKPIleIwPzW");
  assert.equal(event.applicationCount, 12);
  assert.equal(applications.length, 12);
  assert.equal(counts.ready, 3);
  assert.equal(counts.needsInfo, 2);
  assert.equal(counts.manual, 1);
  assert.equal(counts.approved, 2);
  assert.equal(counts.waitlist, 1);
  assert.equal(counts.rejected, 3);
  assert.equal(applications[0].lumaPayload.eventApiId, "evt-YQNWbKPIleIwPzW");
  assert.match(applications[0].email, /\.example$/);
  assert.equal(applications[0].lumaPayload.rawFields.event_url, "https://luma.com/dogpatch-founder-breakfast-0623");
  assert.equal(applications[0].lumaStatus, "Pending in Lu.ma");
});

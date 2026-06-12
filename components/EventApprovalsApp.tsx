"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CLARIFICATION_EMAIL_BODY,
  DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
  MAX_CLARIFICATION_EMAIL_BODY_LENGTH,
  MAX_CLARIFICATION_EMAIL_NOTES_LENGTH,
  MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH,
  type ApprovalLens,
  type ApprovalStatus,
  type EventApprovalApplication,
  type LoadedLumaEvent
} from "@/app/lib/event-approvals-types";
import {
  APPROVAL_SEGMENT_FILTERS,
  APPROVAL_SEGMENTS,
  approvalSegmentLabelFor,
  matchesApprovalSegment,
  type ApprovalSegment
} from "@/app/lib/event-approvals-filters";
import { canApprove, canReject, canSendInfo } from "@/app/lib/event-approvals-state";
import {
  captureAnalyticsEvent,
  confidenceBucket,
  countBucket,
  textLengthBucket
} from "@/lib/analytics";
import { SiteHeader } from "@/components/SiteHeader";

const PAGE_SIZE = 25;
const AVATAR_DIMENSIONS = {
  small: 36,
  large: 104
} as const;

type ApprovalQueue =
  | "all"
  | "ready"
  | "needs_info"
  | "awaiting_reply"
  | "manual"
  | "waitlist"
  | "approved"
  | "rejected";

type ApiApprovalSegment =
  | "all"
  | "yc_founders"
  | "possible_yc"
  | "investors"
  | "network"
  | "unmapped"
  | "capacity";

type ApprovalQueueCounts = Record<ApprovalQueue, number>;
type ApprovalSegmentCounts = Record<ApiApprovalSegment, number>;

type EventApprovalsListPayload = {
  event: LoadedLumaEvent;
  applications: EventApprovalApplication[];
  total: number;
  page: number;
  pageSize: number;
  counts: ApprovalQueueCounts;
  segmentCounts: ApprovalSegmentCounts;
  query: {
    eventId: string;
    queue: ApprovalQueue;
    segment: ApiApprovalSegment;
    aiDecision: string;
    search: string;
    page: number;
    pageSize: number;
  };
};

export type EventApprovalsInitialData = {
  events: LoadedLumaEvent[];
  initialList: EventApprovalsListPayload | null;
};

type ClarificationComposerState = {
  targetIds: string[];
  targets: EventApprovalApplication[];
  targetCount: number;
  scope: BulkSelectionScope;
  notes: string;
  isGenerating: boolean;
  draftError: string;
  draftSource?: "ai" | "fallback";
  subject: string;
  body: string;
};

type BulkApprovalQueryPayload = {
  queue: ApprovalQueue;
  segment: ApiApprovalSegment;
  aiDecision: string;
  search: string;
  page: number;
  pageSize: number;
};

type BulkSelectionScope =
  | {
      type: "ids";
      applicationIds: string[];
    }
  | {
      type: "query";
      query: BulkApprovalQueryPayload;
      targetCount: number;
    };

const EMPTY_QUEUE_COUNTS: ApprovalQueueCounts = {
  all: 0,
  ready: 0,
  needs_info: 0,
  awaiting_reply: 0,
  manual: 0,
  waitlist: 0,
  approved: 0,
  rejected: 0
};

const EMPTY_SEGMENT_COUNTS: ApprovalSegmentCounts = {
  all: 0,
  yc_founders: 0,
  possible_yc: 0,
  investors: 0,
  network: 0,
  unmapped: 0,
  capacity: 0
};

const QUEUE_BY_LENS: Record<ApprovalLens, ApprovalQueue> = {
  all: "all",
  ready: "ready",
  needsInfo: "needs_info",
  awaitingReply: "awaiting_reply",
  manual: "manual",
  waitlist: "waitlist",
  approved: "approved",
  rejected: "rejected"
};

const LENS_BY_QUEUE: Record<ApprovalQueue, ApprovalLens> = {
  all: "all",
  ready: "ready",
  needs_info: "needsInfo",
  awaiting_reply: "awaitingReply",
  manual: "manual",
  waitlist: "waitlist",
  approved: "approved",
  rejected: "rejected"
};

const SEGMENT_BY_UI: Record<ApprovalSegment, ApiApprovalSegment> = {
  all: "all",
  ycFounders: "yc_founders",
  possibleYc: "possible_yc",
  investors: "investors",
  network: "network",
  unmapped: "unmapped",
  capacity: "capacity"
};

const APPROVAL_LENSES: Array<{ id: ApprovalLens; label: string }> = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "needsInfo", label: "Needs info" },
  { id: "awaitingReply", label: "Awaiting" },
  { id: "manual", label: "Manual" },
  { id: "waitlist", label: "Waitlist" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" }
];

const STATUS_META: Record<ApprovalStatus, { label: string; pillClass: string }> = {
  ready: { label: "Ready", pillClass: "ai" },
  needsInfo: { label: "Needs info", pillClass: "warn" },
  awaitingReply: { label: "Awaiting", pillClass: "" },
  manual: { label: "Manual", pillClass: "warn" },
  waitlist: { label: "Waitlist", pillClass: "" },
  approved: { label: "Approved", pillClass: "ai" },
  rejected: { label: "Rejected", pillClass: "warn" }
};

export function EventApprovalsApp({ data }: { data: EventApprovalsInitialData }) {
  const initialList = data.initialList;
  const [selectedEventId, setSelectedEventId] = useState(initialList?.event.id ?? data.events[0]?.id ?? "");
  const [applications, setApplications] = useState(initialList?.applications ?? []);
  const [counts, setCounts] = useState<ApprovalQueueCounts>(initialList?.counts ?? EMPTY_QUEUE_COUNTS);
  const [segmentCounts, setSegmentCounts] = useState<ApprovalSegmentCounts>(initialList?.segmentCounts ?? EMPTY_SEGMENT_COUNTS);
  const [total, setTotal] = useState(initialList?.total ?? 0);
  const [lens, setLens] = useState<ApprovalLens>(initialList ? LENS_BY_QUEUE[initialList.query.queue] : "all");
  const [segment, setSegment] = useState<ApprovalSegment>("all");
  const [query, setQuery] = useState(initialList?.query.search ?? "");
  const [page, setPage] = useState(initialList?.page ?? 1);
  const [selectedId, setSelectedId] = useState(
    applications.find((application) => application.selectedDefault)?.id ??
      applications[0]?.id ??
      ""
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(applications.filter((application) => application.selectedDefault).map((application) => application.id))
  );
  const [allResultsSelected, setAllResultsSelected] = useState(false);
  const [dossierApplication, setDossierApplication] = useState<EventApprovalApplication | null>(null);
  const [clarificationComposer, setClarificationComposer] = useState<ClarificationComposerState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const viewedRef = useRef(false);
  const skippedInitialRequestRef = useRef(false);
  const requestRef = useRef(0);
  const initialRequestKeyRef = useRef(
    initialList
      ? approvalRequestKey(
          initialList.event.id,
          LENS_BY_QUEUE[initialList.query.queue],
          "all",
          initialList.query.search,
          initialList.page
        )
      : ""
  );

  const selectedEvent = useMemo(() => {
    return data.events.find((event) => event.id === selectedEventId) ?? data.events[0];
  }, [data.events, selectedEventId]);
  const eventId = selectedEvent?.id ?? "unknown";

  const applicationsById = useMemo(() => {
    return new Map(applications.map((application) => [application.id, application]));
  }, [applications]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const boundedPage = Math.min(page, totalPages);
  const pageStart = (boundedPage - 1) * PAGE_SIZE;
  const visibleApplications = applications;
  const selectedCandidate = applicationsById.get(selectedId);
  const selectedApplication =
    selectedCandidate?.eventId === selectedEvent?.id
      ? selectedCandidate
      : visibleApplications[0];

  const selectedForEvent = useMemo(() => {
    if (allResultsSelected) return applications;
    return applications.filter((application) => selectedIds.has(application.id));
  }, [allResultsSelected, applications, selectedIds]);

  const selectedInResults = selectedForEvent;
  const selectedInResultsCount = allResultsSelected ? total : selectedInResults.length;
  const approvableSelectedCount = allResultsSelected
    ? allResultsActionCount("approve", lens, total)
    : selectedInResults.filter(canApprove).length;
  const infoSelectedCount = allResultsSelected
    ? allResultsActionCount("send_info", lens, total)
    : selectedInResults.filter(canSendInfo).length;
  const rejectableSelectedCount = allResultsSelected
    ? allResultsActionCount("reject", lens, total)
    : selectedInResults.filter(canReject).length;

  const loadApprovals = useCallback(async (overrides: Partial<{
    eventId: string;
    lens: ApprovalLens;
    segment: ApprovalSegment;
    query: string;
    page: number;
    signal: AbortSignal;
  }> = {}) => {
    const nextEventId = overrides.eventId ?? selectedEventId;
    if (!nextEventId) return;

    const nextLens = overrides.lens ?? lens;
    const nextSegment = overrides.segment ?? segment;
    const nextQuery = overrides.query ?? query;
    const nextPage = overrides.page ?? page;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    const params = new URLSearchParams({
      queue: QUEUE_BY_LENS[nextLens],
      segment: SEGMENT_BY_UI[nextSegment],
      search: nextQuery,
      page: String(nextPage),
      pageSize: String(PAGE_SIZE)
    });

    setIsLoading(true);
    setLoadError("");

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(nextEventId)}/approvals?${params.toString()}`,
        { signal: overrides.signal }
      );
      if (!response.ok) throw new Error(`Approval API returned ${response.status}.`);
      const payload = await response.json() as EventApprovalsListPayload;
      if (requestRef.current !== requestId) return;

      setApplications(payload.applications);
      setCounts(payload.counts);
      setSegmentCounts(payload.segmentCounts);
      setTotal(payload.total);
      setPage(payload.page);
      setSelectedId((current) =>
        payload.applications.some((application) => application.id === current)
          ? current
          : payload.applications.find((application) => application.selectedDefault)?.id ?? payload.applications[0]?.id ?? ""
      );
      setSelectedIds((current) => {
        const visibleIds = new Set(payload.applications.map((application) => application.id));
        return new Set([...current].filter((id) => visibleIds.has(id)));
      });
    } catch (error) {
      if (overrides.signal?.aborted) return;
      if (requestRef.current === requestId) {
        setLoadError(error instanceof Error ? error.message : "Unable to load approvals.");
      }
    } finally {
      if (!overrides.signal?.aborted && requestRef.current === requestId) setIsLoading(false);
    }
  }, [lens, page, query, segment, selectedEventId]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;

    captureAnalyticsEvent("approvals viewed", {
      application_count: total,
      event_count: data.events.length,
      page_size: PAGE_SIZE
    });
  }, [data.events.length, total]);

  useEffect(() => {
    const requestKey = approvalRequestKey(selectedEventId, lens, segment, query, boundedPage);
    if (!skippedInitialRequestRef.current && requestKey === initialRequestKeyRef.current) {
      skippedInitialRequestRef.current = true;
      return;
    }
    skippedInitialRequestRef.current = true;

    const controller = new AbortController();
    void loadApprovals({ page: boundedPage, signal: controller.signal });

    return () => controller.abort();
  }, [boundedPage, lens, loadApprovals, query, segment, selectedEventId]);

  useEffect(() => {
    if (page === boundedPage) return;
    setPage(boundedPage);
  }, [boundedPage, page]);

  useEffect(() => {
    if (!selectedApplication) {
      setSelectedId(applications[0]?.id ?? "");
      return;
    }

    if (applications.some((application) => application.id === selectedApplication.id)) return;
    setSelectedId(applications[0]?.id ?? "");
  }, [applications, selectedApplication]);

  useEffect(() => {
    if (!dossierApplication && !clarificationComposer) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDossierApplication(null);
      setClarificationComposer(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [clarificationComposer, dossierApplication]);

  function changeEvent(nextEventId: string) {
    const nextEvent = data.events.find((event) => event.id === nextEventId);
    captureAnalyticsEvent("approval event changed", {
      application_count: nextEvent?.applicationCount ?? 0,
      event_count: data.events.length,
      event_id: nextEventId
    });
    setSelectedEventId(nextEventId);
    setPage(1);
    setSelectedIds(new Set());
    setAllResultsSelected(false);
    setDossierApplication(null);
  }

  function changeLens(nextLens: ApprovalLens) {
    captureAnalyticsEvent("approval queue changed", {
      event_id: eventId,
      queue: nextLens,
      result_count: total
    });
    setLens(nextLens);
    setPage(1);
    setAllResultsSelected(false);
  }

  function changeSegment(nextSegment: ApprovalSegment) {
    captureAnalyticsEvent("approval segment changed", {
      event_id: eventId,
      result_count: total,
      segment: nextSegment
    });
    setSegment(nextSegment);
    setPage(1);
    setAllResultsSelected(false);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setPage(1);
    setAllResultsSelected(false);
  }

  function captureSearchSubmitted() {
    captureAnalyticsEvent("approval search submitted", {
      event_id: eventId,
      query_length_bucket: textLengthBucket(query),
      result_count: total
    });
  }

  function goToPage(nextPage: number) {
    const safePage = Math.max(1, Math.min(totalPages, nextPage));
    captureAnalyticsEvent("approval page changed", {
      event_id: eventId,
      page: safePage,
      page_size: PAGE_SIZE,
      result_count: total,
      total_pages: totalPages
    });
    setPage(safePage);
  }

  function toggleSelected(applicationId: string) {
    const application = applicationsById.get(applicationId);
    if (application) {
      captureAnalyticsEvent("application selection toggled", {
        ...applicationAnalyticsProperties(eventId, application),
        selected: !selectedIds.has(applicationId)
      });
    }

    if (allResultsSelected) {
      setAllResultsSelected(false);
      setSelectedIds(new Set(applications.filter((application) => application.id !== applicationId).map((application) => application.id)));
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(applicationId)) {
        next.delete(applicationId);
      } else {
        next.add(applicationId);
      }
      return next;
    });
  }

  function selectApplications(targets: EventApprovalApplication[], scope: "page" | "results") {
    captureAnalyticsEvent("bulk applications selected", {
      count_bucket: countBucket(targets.length),
      event_id: eventId,
      scope
    });

    setAllResultsSelected(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const application of targets) next.add(application.id);
      return next;
    });
  }

  function selectAllResults() {
    captureAnalyticsEvent("bulk applications selected", {
      count_bucket: countBucket(total),
      event_id: eventId,
      scope: "results"
    });

    setSelectedIds(new Set());
    setAllResultsSelected(true);
  }

  function clearSelection() {
    captureAnalyticsEvent("bulk selection cleared", {
      count_bucket: countBucket(selectedInResultsCount),
      event_id: eventId
    });

    if (allResultsSelected) {
      setAllResultsSelected(false);
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      for (const application of applications) {
        next.delete(application.id);
      }
      return next;
    });
  }

  async function approveSelected() {
    if (allResultsSelected) {
      await runBulkAction("approve", new Set(), {
        scope: currentQuerySelectionScope("approve")
      });
      return;
    }

    const targetIds = new Set(
      selectedInResults
        .filter(canApprove)
        .map((application) => application.id)
    );
    if (targetIds.size === 0) return;

    await runBulkAction("approve", targetIds);
  }

  async function sendInfoForSelected() {
    if (allResultsSelected) {
      openClarificationComposer(new Set(), currentQuerySelectionScope("send_info"));
      return;
    }

    const targetIds = new Set(
      selectedInResults
        .filter(canSendInfo)
        .map((application) => application.id)
    );
    if (targetIds.size === 0) return;

    openClarificationComposer(targetIds);
  }

  async function rejectSelected() {
    if (allResultsSelected) {
      await runBulkAction("reject", new Set(), {
        scope: currentQuerySelectionScope("reject")
      });
      return;
    }

    const targetIds = new Set(
      selectedInResults
        .filter(canReject)
        .map((application) => application.id)
    );
    if (targetIds.size === 0) return;

    await runBulkAction("reject", targetIds);
  }

  async function approveApplication(applicationId: string) {
    const application = applicationsById.get(applicationId);
    if (!application || !canApprove(application)) return;
    if (application) captureApplicationAction("approve", application);

    await runBulkAction("approve", new Set([applicationId]));
  }

  async function rejectApplication(applicationId: string) {
    const application = applicationsById.get(applicationId);
    if (!application || !canReject(application)) return;
    if (application) captureApplicationAction("reject", application);

    await runBulkAction("reject", new Set([applicationId]));
  }

  async function sendInfoForApplication(applicationId: string) {
    const application = applicationsById.get(applicationId);
    if (!application || !canSendInfo(application)) return;
    if (application) captureApplicationAction("send_info", application);

    openClarificationComposer(new Set([applicationId]));
  }

  function openClarificationComposer(targetIds: Set<string>, scope?: BulkSelectionScope) {
    const targets = scope?.type === "query"
      ? applications.filter(canSendInfo)
      : applications.filter((application) => targetIds.has(application.id) && canSendInfo(application));
    if (targets.length === 0) return;

    setClarificationComposer({
      targetIds: targets.map((application) => application.id),
      targets,
      targetCount: scope?.type === "query" ? scope.targetCount : targets.length,
      scope: scope ?? { type: "ids", applicationIds: targets.map((application) => application.id) },
      notes: "",
      isGenerating: false,
      draftError: "",
      subject: DEFAULT_CLARIFICATION_EMAIL_SUBJECT,
      body: DEFAULT_CLARIFICATION_EMAIL_BODY
    });
  }

  async function submitClarificationEmail() {
    if (!clarificationComposer) return;
    const subject = clarificationComposer.subject.trim();
    const body = clarificationComposer.body.trim();
    if (!subject || !body) return;

    const succeeded = await runBulkAction("send_info", new Set(clarificationComposer.targetIds), {
      scope: clarificationComposer.scope,
      clarificationEmail: { subject, body }
    });
    if (succeeded) setClarificationComposer(null);
  }

  async function generateClarificationEmail() {
    if (!clarificationComposer || !clarificationComposer.notes.trim()) return;

    const scope = clarificationComposer.scope;
    const requestedNotes = clarificationComposer.notes;
    const requestedScopeKey = bulkSelectionScopeKey(scope);
    setClarificationComposer((current) => current
      ? { ...current, isGenerating: true, draftError: "", draftSource: undefined }
      : current
    );

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/approvals/email-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notes: clarificationComposer.notes,
          ...(scope.type === "query" ? { query: scope.query } : { applicationIds: scope.applicationIds })
        })
      });
      if (!response.ok) throw new Error(await approvalActionErrorMessage(response));

      const draft = await response.json() as {
        subject: string;
        body: string;
        source: "ai" | "fallback";
      };
      setClarificationComposer((current) => current
        && current.notes === requestedNotes
        && bulkSelectionScopeKey(current.scope) === requestedScopeKey
          ? {
            ...current,
            subject: draft.subject,
            body: draft.body,
            draftSource: draft.source,
            draftError: "",
            isGenerating: false
          }
        : current
      );
    } catch (error) {
      setClarificationComposer((current) => current
        && current.notes === requestedNotes
        && bulkSelectionScopeKey(current.scope) === requestedScopeKey
          ? {
            ...current,
            draftError: error instanceof Error ? error.message : "Unable to draft clarification email.",
            isGenerating: false
          }
        : current
      );
    }
  }

  async function runBulkAction(
    action: "approve" | "send_info" | "reject",
    targetIds: Set<string>,
    options: {
      clarificationEmail?: { subject: string; body: string };
      scope?: BulkSelectionScope;
    } = {}
  ) {
    if (options.scope?.type === "query") {
      return runQueryBulkAction(action, options.scope, options.clarificationEmail);
    }

    const eligibleIds = eligibleIdsForAction(action, applications, targetIds);
    if (eligibleIds.size === 0) return false;

    requestRef.current += 1;
    const previousApplications = applications;
    const previousCounts = counts;
    const previousSegmentCounts = segmentCounts;
    const previousTotal = total;
    const nextApplications = applications.filter((application) => !eligibleIds.has(application.id));

    captureBulkApprovalAction(action, eligibleIds.size);
    setApplications(nextApplications);
    setTotal(Math.max(0, total - eligibleIds.size));
    setSelectedId((current) => eligibleIds.has(current) ? nextApplications[0]?.id ?? "" : current);
    adjustCountsForOptimisticAction(action, eligibleIds, previousApplications);
    removeSelectedIds(eligibleIds);
    setIsLoading(true);
    setLoadError("");

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/approvals/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          applicationIds: [...eligibleIds],
          actorName: "YC OS",
          ...(options.clarificationEmail ? { clarificationEmail: options.clarificationEmail } : {})
        })
      });
      if (!response.ok) throw new Error(await approvalActionErrorMessage(response));
      return true;
    } catch (error) {
      setApplications(previousApplications);
      setCounts(previousCounts);
      setSegmentCounts(previousSegmentCounts);
      setTotal(previousTotal);
      await loadApprovals({ lens, segment, page: boundedPage });
      setLoadError(error instanceof Error ? error.message : "Unable to apply approval action.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function runQueryBulkAction(
    action: "approve" | "send_info" | "reject",
    scope: Extract<BulkSelectionScope, { type: "query" }>,
    clarificationEmail?: { subject: string; body: string }
  ) {
    if (scope.targetCount === 0) return false;

    requestRef.current += 1;
    const previousApplications = applications;
    const previousCounts = counts;
    const previousSegmentCounts = segmentCounts;
    const previousTotal = total;

    captureBulkApprovalAction(action, scope.targetCount);
    setIsLoading(true);
    setLoadError("");

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/approvals/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          query: scope.query,
          actorName: "YC OS",
          ...(clarificationEmail ? { clarificationEmail } : {})
        })
      });
      if (!response.ok) throw new Error(await approvalActionErrorMessage(response));

      setSelectedIds(new Set());
      setAllResultsSelected(false);
      await loadApprovals({ lens, segment, page: boundedPage });
      return true;
    } catch (error) {
      setApplications(previousApplications);
      setCounts(previousCounts);
      setSegmentCounts(previousSegmentCounts);
      setTotal(previousTotal);
      setLoadError(error instanceof Error ? error.message : "Unable to apply approval action.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  function removeSelectedIds(ids: Set<string>) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  function adjustCountsForOptimisticAction(
    action: "approve" | "send_info" | "reject",
    ids: Set<string>,
    previousApplications: EventApprovalApplication[]
  ) {
    const affected = previousApplications.filter((application) => ids.has(application.id));
    const destinationQueue = queueForAction(action);

    setCounts((current) => {
      const next = { ...current };
      for (const application of affected) {
        const sourceQueue = queueForStatus(application.status);
        next[sourceQueue] = Math.max(0, next[sourceQueue] - 1);
        next[destinationQueue] += 1;
      }
      return next;
    });

    setSegmentCounts((current) => {
      const next = { ...current };
      for (const application of affected) {
        for (const segmentItem of APPROVAL_SEGMENTS) {
          if (!matchesApprovalSegment(application, segmentItem.id)) continue;
          const key = SEGMENT_BY_UI[segmentItem.id];
          next[key] = Math.max(0, next[key] - 1);
        }
      }
      return next;
    });
  }

  function currentQuerySelectionScope(action: "approve" | "send_info" | "reject"): BulkSelectionScope {
    return {
      type: "query",
      query: currentBulkApprovalQuery(lens, segment, query),
      targetCount: allResultsActionCount(action, lens, total)
    };
  }

  function clearFilters() {
    const nextLens: ApprovalLens = "all";
    const nextSegment: ApprovalSegment = "all";
    const nextQuery = "";
    const nextPage = 1;

    setLens(nextLens);
    setSegment(nextSegment);
    setQuery(nextQuery);
    setPage(nextPage);
    setSelectedIds(new Set());
    setAllResultsSelected(false);
    void loadApprovals({
      lens: nextLens,
      segment: nextSegment,
      query: nextQuery,
      page: nextPage
    });
  }

  function selectApplication(application: EventApprovalApplication) {
    captureAnalyticsEvent("application selected", applicationAnalyticsProperties(eventId, application));
    setSelectedId(application.id);
  }

  async function openDossier(application: EventApprovalApplication) {
    captureAnalyticsEvent("approval dossier opened", applicationAnalyticsProperties(eventId, application));
    setDossierApplication(application);

    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(application.id)}/dossier`);
      if (!response.ok) return;
      const payload = await response.json() as { application: EventApprovalApplication };
      setDossierApplication(payload.application);
    } catch {
      setDossierApplication(application);
    }
  }

  function closeDossier(application: EventApprovalApplication) {
    captureAnalyticsEvent("approval dossier closed", applicationAnalyticsProperties(eventId, application));
    setDossierApplication(null);
  }

  function captureApplicationAction(action: "approve" | "send_info" | "reject", application: EventApprovalApplication) {
    captureAnalyticsEvent("application action clicked", {
      ...applicationAnalyticsProperties(eventId, application),
      action
    });
  }

  function captureBulkApprovalAction(action: "approve" | "send_info" | "reject", eligibleCount: number) {
    captureAnalyticsEvent("bulk approval action clicked", {
      action,
      eligible_count_bucket: countBucket(eligibleCount),
      event_id: eventId,
      selected_count_bucket: countBucket(selectedInResultsCount)
    });
  }

  const firstVisible = total === 0 ? 0 : pageStart + 1;
  const lastVisible = Math.min(pageStart + visibleApplications.length, total);

  return (
    <main className="app-shell">
      <SiteHeader active="approvals" />

      <section className="workspace" aria-label="Event approval workspace">
        <section className="main-pane">
          <div className="toolbar prep-toolbar approvals-toolbar">
            <div className="prep-toolbar-top approval-toolbar-top">
              <div className="toolbar-title-block approval-context">
                <div className="queue-title">{selectedEvent?.title ?? "Event approvals"}</div>
                <div className="toolbar-subtitle">
                  {selectedEvent?.applicationCount ?? 0} applications | {selectedEvent?.seats ?? 0} seats | {data.events.length} events loaded
                </div>
              </div>
              <label className="event-select-wrap prep-event-select">
                <span className="sr-only">Select event</span>
                <select
                  className="event-select"
                  value={selectedEventId}
                  onChange={(event) => changeEvent(event.target.value)}
                >
                  {data.events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="prep-event-actions">
                {selectedEvent?.url ? (
                  <a className="event-source-link" href={selectedEvent.url} rel="noreferrer" target="_blank">
                    Open Lu.ma
                  </a>
                ) : null}
              </div>
            </div>

            <div className="approval-toolbar-row approval-queue-row">
              <div className="lens-group approval-queue-tabs" aria-label="Approval queues">
                {APPROVAL_LENSES.map((item) => (
                  <button
                    className={`chip${lens === item.id ? " active" : ""}`}
                    key={item.id}
                    onClick={() => changeLens(item.id)}
                    type="button"
                  >
                    {item.label}
                    <span className="chip-count">{counts[QUEUE_BY_LENS[item.id]]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="prep-toolbar-controls approval-filter-row">
              <label className="event-select-wrap segment-select-wrap">
                <span className="sr-only">Applicant segment</span>
                <select
                  className="event-select"
                  value={segment}
                  onChange={(event) => changeSegment(event.target.value as ApprovalSegment)}
                >
                  {APPROVAL_SEGMENT_FILTERS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} ({segmentCounts[SEGMENT_BY_UI[item.id]]})
                    </option>
                  ))}
                </select>
              </label>
              <label className="search-wrap prep-search approval-search">
                <span className="sr-only">Search applications</span>
                <input
                  value={query}
                  onBlur={captureSearchSubmitted}
                  onChange={(event) => changeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") captureSearchSubmitted();
                  }}
                  placeholder="Search event applications..."
                />
              </label>
              <div className="pager-actions approval-status" aria-live="polite">
                <span className="queue-count">
                  {isLoading
                    ? "Loading..."
                    : total > 0
                      ? `${firstVisible}-${lastVisible} of ${total} | ${selectedInResultsCount} selected`
                      : "No applications"}
                </span>
                <button className="note-btn" disabled={boundedPage === 1 || isLoading} onClick={() => goToPage(boundedPage - 1)} type="button">
                  Previous
                </button>
                <button className="note-btn" disabled={boundedPage === totalPages || isLoading} onClick={() => goToPage(boundedPage + 1)} type="button">
                  Next
                </button>
              </div>
            </div>

            <div className="approval-toolbar-row approval-actions-row">
              <div className="pager-actions approval-actions" aria-label="Approval actions">
                <button
                  className="note-btn"
                  disabled={visibleApplications.length === 0}
                  onClick={() => selectApplications(visibleApplications, "page")}
                  type="button"
                >
                  Select page ({visibleApplications.length})
                </button>
                <button
                  className="note-btn"
                  disabled={total === 0 || allResultsSelected}
                  onClick={selectAllResults}
                  type="button"
                >
                  Select all ({total})
                </button>
                <button className="note-btn" disabled={selectedInResultsCount === 0} onClick={clearSelection} type="button">
                  Clear ({selectedInResultsCount})
                </button>
                <button className="note-btn" disabled={isLoading || infoSelectedCount === 0} onClick={sendInfoForSelected} type="button">
                  Send info ({infoSelectedCount})
                </button>
                <button className="note-btn danger" disabled={isLoading || rejectableSelectedCount === 0} onClick={rejectSelected} type="button">
                  Reject ({rejectableSelectedCount})
                </button>
                <button className="note-btn primary" disabled={isLoading || approvableSelectedCount === 0} onClick={approveSelected} type="button">
                  Approve ({approvableSelectedCount})
                </button>
              </div>
            </div>
          </div>
          {loadError ? <div className="empty-inline">{loadError}</div> : null}

          <div className="content-grid">
            <aside className="directory-shell" aria-label="Event application list">
              <div className="directory">
                {visibleApplications.length > 0 ? (
                  visibleApplications.map((application) => (
                    <ApprovalRow
                      active={selectedApplication?.id === application.id}
                      application={application}
                      checked={allResultsSelected || selectedIds.has(application.id)}
                      key={application.id}
                      onSelect={() => selectApplication(application)}
                      onToggleSelected={() => toggleSelected(application.id)}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>No matching applications</strong>
                    <span>Try a broader search or another approval queue.</span>
                    <button
                      className="note-btn"
                      onClick={clearFilters}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </aside>

            {selectedApplication ? (
              <ApplicationDetail
                application={selectedApplication}
                onApprove={() => approveApplication(selectedApplication.id)}
                onOpenDossier={() => openDossier(selectedApplication)}
                onReject={() => rejectApplication(selectedApplication.id)}
                onSendInfo={() => sendInfoForApplication(selectedApplication.id)}
              />
            ) : (
              <article className="profile empty-profile">
                <div className="label">Selection</div>
                <p>No application selected.</p>
              </article>
            )}
          </div>
        </section>
      </section>

      {dossierApplication ? (
        <DossierModal application={dossierApplication} onClose={() => closeDossier(dossierApplication)} />
      ) : null}
      {clarificationComposer ? (
        <ClarificationComposer
          composer={clarificationComposer}
          disabled={isLoading}
          onBodyChange={(body) => setClarificationComposer((current) => current ? { ...current, body } : current)}
          onClose={() => setClarificationComposer(null)}
          onGenerate={generateClarificationEmail}
          onNotesChange={(notes) => setClarificationComposer((current) => current
            ? { ...current, notes, draftError: "", draftSource: undefined, isGenerating: false }
            : current
          )}
          onSend={submitClarificationEmail}
          onSubjectChange={(subject) => setClarificationComposer((current) => current ? { ...current, subject } : current)}
        />
      ) : null}
    </main>
  );
}

function ApprovalRow({
  active,
  application,
  checked,
  onSelect,
  onToggleSelected
}: {
  active: boolean;
  application: EventApprovalApplication;
  checked: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
}) {
  const status = STATUS_META[application.status];
  const matchSignal = matchSignalFor(application);
  const segmentLabel = approvalSegmentLabelFor(application);

  return (
    <div className={`approval-row${active ? " active" : ""}`}>
      <input
        aria-label={`Select ${application.name}`}
        checked={checked}
        className="approval-check ph-no-capture"
        onChange={onToggleSelected}
        type="checkbox"
      />
      <button className="approval-row-main ph-no-capture" onClick={onSelect} type="button">
        <ApplicationAvatar application={application} size="small" />
        <span className="row-copy">
          <span className="name">{application.name}</span>
          <span className="company-line">{application.companyLine}</span>
          <span className="ask-line">{application.email}</span>
          <span className="row-foot">
            <span className={`row-pill${status.pillClass ? ` ${status.pillClass}` : ""}`}>{status.label}</span>
            <span className="row-pill">{segmentLabel}</span>
            <span className={`row-pill${matchSignal.pillClass ? ` ${matchSignal.pillClass}` : ""}`}>
              {matchSignal.label}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

function approvalRequestKey(
  eventId: string,
  lens: ApprovalLens,
  segment: ApprovalSegment,
  query: string,
  page: number
) {
  return `${eventId}:${lens}:${segment}:${query}:${page}`;
}

function eligibleIdsForAction(
  action: "approve" | "send_info" | "reject",
  applications: EventApprovalApplication[],
  ids: Set<string>
) {
  const eligible = new Set<string>();
  for (const application of applications) {
    if (!ids.has(application.id)) continue;
    if (action === "approve" && canApprove(application)) eligible.add(application.id);
    if (action === "send_info" && canSendInfo(application)) eligible.add(application.id);
    if (action === "reject" && canReject(application)) eligible.add(application.id);
  }
  return eligible;
}

function currentBulkApprovalQuery(
  lens: ApprovalLens,
  segment: ApprovalSegment,
  search: string
): BulkApprovalQueryPayload {
  return {
    queue: QUEUE_BY_LENS[lens],
    segment: SEGMENT_BY_UI[segment],
    aiDecision: "all",
    search,
    page: 1,
    pageSize: PAGE_SIZE
  };
}

function bulkSelectionScopeKey(scope: BulkSelectionScope) {
  if (scope.type === "ids") return `ids:${scope.applicationIds.join(",")}`;
  return `query:${JSON.stringify(scope.query)}`;
}

function allResultsActionCount(
  action: "approve" | "send_info" | "reject",
  lens: ApprovalLens,
  total: number
) {
  if (total === 0) return 0;
  if (action === "send_info") return lens === "awaitingReply" ? 0 : total;
  if (action === "approve") return lens === "approved" ? 0 : total;
  return lens === "rejected" ? 0 : total;
}

function queueForAction(action: "approve" | "send_info" | "reject"): ApprovalQueue {
  if (action === "approve") return "approved";
  if (action === "send_info") return "awaiting_reply";
  return "rejected";
}

function queueForStatus(status: ApprovalStatus): ApprovalQueue {
  if (status === "needsInfo") return "needs_info";
  if (status === "awaitingReply") return "awaiting_reply";
  return status;
}

async function approvalActionErrorMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (payload?.message) return payload.message;
  return "Unable to queue that approval action. The list has been refreshed.";
}

function ApplicationDetail({
  application,
  onApprove,
  onOpenDossier,
  onReject,
  onSendInfo
}: {
  application: EventApprovalApplication;
  onApprove: () => void;
  onOpenDossier: () => void;
  onReject: () => void;
  onSendInfo: () => void;
}) {
  const status = STATUS_META[application.status];
  const canApproveApplication = canApprove(application);
  const canRejectApplication = canReject(application);
  const canSend = canSendInfo(application);

  return (
    <article className="profile approval-profile">
      <div className="profile-top">
        <ApplicationAvatar application={application} size="large" />
        <div className="profile-heading ph-no-capture">
          <h1>{application.name}</h1>
          <div className="profile-sub">
            {application.companyLine} | {application.phone}
          </div>
          <div className="approval-status-bar">
            <span className={`row-pill${status.pillClass ? ` ${status.pillClass}` : ""}`}>{status.label}</span>
            <span>{application.lumaStatus}</span>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="label">Decision</div>
        <div className="approval-decision ph-no-capture">
          <strong>{application.recommendation}</strong>
          <span>{application.rule}</span>
        </div>
        <div className="detail-actions">
          <button className="note-btn primary" disabled={!canApproveApplication} onClick={onApprove} type="button">
            Approve
          </button>
          <button className="note-btn" disabled={!canSend} onClick={onSendInfo} type="button">
            Send info request
          </button>
          <button className="note-btn danger" disabled={!canRejectApplication} onClick={onReject} type="button">
            Reject
          </button>
          <button className="note-btn" onClick={onOpenDossier} type="button">
            Open dossier
          </button>
        </div>
      </section>

      <section className="section">
        <div className="label">YC evidence</div>
        <div className="approval-evidence ph-no-capture">
          {application.evidence.map((item) => (
            <div className={`evidence-line ${item.tone}`} key={`${item.label}-${item.value}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      {application.clarificationRequest ? (
        <section className="section">
          <div className="label">Clarification email</div>
          <div className="approval-email-preview ph-no-capture">
            <span>From: {application.clarificationRequest.sentFrom}</span>
            <strong>{application.clarificationRequest.subject}</strong>
            <p>{application.clarificationRequest.preview}</p>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="label">Reply parser</div>
        {application.parsedReply ? (
          <div className="approval-email-preview ph-no-capture">
            <div className="match-top">
              <strong>{application.parsedReply.summary}</strong>
              <div className={`confidence${application.parsedReply.aiDecision === "manual" ? " warn" : ""}`}>
                AI {application.parsedReply.aiDecision}
              </div>
            </div>
            <div className="match-summary">{application.parsedReply.reason}</div>
            <div className="evidence">
              {application.parsedReply.extracted.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-inline">No applicant reply parsed yet.</div>
        )}
      </section>

      <section className="section">
        <div className="label">Audit trail</div>
        <div className="notes-list ph-no-capture">
          {application.audit.map((item) => (
            <div className="note-row" key={item}>
              <span className="note-source">Rule log</span>
              <div className="note-text">{item}</div>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function ClarificationComposer({
  composer,
  disabled,
  onBodyChange,
  onClose,
  onGenerate,
  onNotesChange,
  onSend,
  onSubjectChange
}: {
  composer: ClarificationComposerState;
  disabled: boolean;
  onBodyChange: (body: string) => void;
  onClose: () => void;
  onGenerate: () => void;
  onNotesChange: (notes: string) => void;
  onSend: () => void;
  onSubjectChange: (subject: string) => void;
}) {
  const canSend = composer.subject.trim().length > 0 &&
    composer.body.trim().length > 0 &&
    composer.subject.length <= MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH &&
    composer.body.length <= MAX_CLARIFICATION_EMAIL_BODY_LENGTH;
  const canGenerate = composer.notes.trim().length > 0 &&
    composer.notes.length <= MAX_CLARIFICATION_EMAIL_NOTES_LENGTH;

  return (
    <div className="dossier-backdrop" onMouseDown={onClose}>
      <aside
        aria-labelledby="clarification-composer-title"
        aria-modal="true"
        className="dossier-card email-composer-card ph-no-capture"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dossier-head">
          <div>
            <div className="label">Clarification email</div>
            <h1 id="clarification-composer-title">
              {composer.targetCount === 1 ? composer.targets[0]?.name : `${composer.targetCount} applicants`}
            </h1>
            <div className="profile-sub">{recipientSummary(composer.targets, composer.targetCount)}</div>
          </div>
          <button className="note-btn" disabled={disabled} onClick={onClose} type="button">
            Cancel
          </button>
        </div>

        <div className="composer-form">
          <label className="composer-field">
            <span>Notes</span>
            <textarea
              className="composer-notes"
              maxLength={MAX_CLARIFICATION_EMAIL_NOTES_LENGTH}
              onChange={(event) => onNotesChange(event.target.value)}
              rows={3}
              value={composer.notes}
            />
          </label>
          <div className="composer-draft-row">
            <span>
              {composer.draftError
                ? composer.draftError
                : composer.draftSource === "fallback"
                  ? "Drafted locally"
                  : composer.draftSource === "ai"
                    ? "Drafted with AI"
                    : `${composer.notes.length}/${MAX_CLARIFICATION_EMAIL_NOTES_LENGTH}`}
            </span>
            <button
              className="note-btn"
              disabled={disabled || composer.isGenerating || !canGenerate}
              onClick={onGenerate}
              type="button"
            >
              {composer.isGenerating ? "Drafting..." : "AI draft"}
            </button>
          </div>
          <label className="composer-field">
            <span>Subject</span>
            <input
              maxLength={MAX_CLARIFICATION_EMAIL_SUBJECT_LENGTH}
              onChange={(event) => onSubjectChange(event.target.value)}
              value={composer.subject}
            />
          </label>
          <label className="composer-field">
            <span>Message</span>
            <textarea
              maxLength={MAX_CLARIFICATION_EMAIL_BODY_LENGTH}
              onChange={(event) => onBodyChange(event.target.value)}
              rows={7}
              value={composer.body}
            />
          </label>
          <div className="composer-foot">
            <span>{composer.body.length}/{MAX_CLARIFICATION_EMAIL_BODY_LENGTH}</span>
            <button className="note-btn primary" disabled={disabled || composer.isGenerating || !canSend} onClick={onSend} type="button">
              Send
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DossierModal({
  application,
  onClose
}: {
  application: EventApprovalApplication;
  onClose: () => void;
}) {
  return (
    <div className="dossier-backdrop" onMouseDown={onClose}>
      <aside
        aria-labelledby="dossier-title"
        aria-modal="true"
        className="dossier-card ph-no-capture"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dossier-head">
          <div className="profile-top">
            <ApplicationAvatar application={application} size="large" />
            <div className="profile-heading">
              <div className="label">Dossier</div>
              <h1 id="dossier-title">{application.name}</h1>
              <div className="profile-sub">{application.companyLine}</div>
            </div>
          </div>
          <button className="note-btn" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="dossier-grid">
          <section className="dossier-panel">
            <div className="label">Identity</div>
            <div className="dossier-facts">
              <Fact label="Email" value={application.email} />
              <Fact label="Phone" value={application.phone} />
              <Fact label="Event ID" value={application.lumaId} />
              <Fact label="Submitted" value={application.submittedAt} />
            </div>
          </section>

          <section className="dossier-panel">
            <div className="label">YC context</div>
            <div className="dossier-facts">
              <Fact label="Segment" value={approvalSegmentLabelFor(application)} />
              <Fact label="Relation" value={application.relation} />
              <Fact label="Company" value={application.companyName} />
              <Fact label="Founder ID" value={application.founderId} />
            </div>
          </section>

          <section className="dossier-panel wide">
            <div className="label">Review basis</div>
            <div className="approval-decision">
              <strong>{application.recommendation}</strong>
              <span>{application.rule}</span>
            </div>
          </section>

          <section className="dossier-panel wide">
            <div className="label">Evidence</div>
            <div className="approval-evidence">
              {application.evidence.map((item) => (
                <div className={`evidence-line ${item.tone}`} key={`dossier-${item.label}-${item.value}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ApplicationAvatar({
  application,
  size
}: {
  application: EventApprovalApplication;
  size: "small" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const className = `avatar avatar-${size}`;

  useEffect(() => {
    setFailed(false);
  }, [application.photoUrl]);

  if (!application.photoUrl || failed) {
    return <span className={`${className} avatar-fallback`}>{initialsFor(application.name)}</span>;
  }

  return (
    <img
      alt={application.name}
      className={className}
      decoding="async"
      height={AVATAR_DIMENSIONS[size]}
      loading={size === "large" ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      src={application.photoUrl}
      width={AVATAR_DIMENSIONS[size]}
    />
  );
}

function matchSignalFor(application: EventApprovalApplication) {
  if (application.status === "ready" || application.status === "approved") {
    return { label: "Verified", pillClass: "ai" };
  }

  if (application.status === "waitlist") {
    return { label: "Verified / capacity", pillClass: "" };
  }

  if (application.status === "awaitingReply") {
    return application.parsedReply
      ? { label: "Reply parsed", pillClass: "" }
      : { label: "Awaiting reply", pillClass: "" };
  }

  if (application.status === "manual") {
    return { label: "Manual check", pillClass: "warn" };
  }

  if (application.status === "rejected") {
    return { label: "Rejected", pillClass: "warn" };
  }

  return { label: "Identity gap", pillClass: "warn" };
}

function recipientSummary(applications: EventApprovalApplication[], targetCount: number) {
  if (applications.length === 0) return "";
  if (targetCount === 1) return applications[0]?.email ?? "";
  return `${targetCount} selected recipients`;
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function applicationAnalyticsProperties(eventId: string, application: EventApprovalApplication) {
  return {
    ai_decision: application.aiRecommendation.decision,
    confidence_bucket: confidenceBucket(application.matchConfidence),
    event_id: eventId,
    relation_type: application.relation,
    segment: approvalSegmentLabelFor(application),
    status: application.status
  };
}

import type { ApprovalStatus, EventApprovalApplication } from "./event-approvals-types";
import { transitionApplication } from "./event-approvals-state";

type LocalApprovalDecision = {
  auditMessage: string;
  status: ApprovalStatus;
};

export type LocalApprovalDecisionSnapshot = {
  applicationId: string;
  eventId: string;
  founderId: string;
  status: ApprovalStatus;
};

type LocalApprovalDecisionRecord = {
  applicationId: string;
  eventId: string;
  founderId: string;
  decisions: LocalApprovalDecision[];
};

type LocalApprovalDecisionStore = {
  records: Map<string, LocalApprovalDecisionRecord>;
  version: number;
};

const STORE_KEY = Symbol.for("yc-os.localApprovalDecisionStore");

export function applyLocalApprovalDecisions(
  applications: EventApprovalApplication[]
): EventApprovalApplication[] {
  const records = localApprovalDecisionStore().records;

  return applications.map((application) => {
    const record = records.get(application.id);
    if (!record) return application;

    return record.decisions.reduce(
      (current, decision) => transitionApplication(current, decision.status, decision.auditMessage),
      application
    );
  });
}

export function recordLocalApprovalDecisions(applications: EventApprovalApplication[]) {
  if (applications.length === 0) return;

  const store = localApprovalDecisionStore();

  for (const application of applications) {
    const existing = store.records.get(application.id);
    const decisions = existing?.decisions.slice() ?? [];
    decisions.push({
      auditMessage: application.audit[0] ?? `Marked ${application.status} in YC OS.`,
      status: application.status
    });
    store.records.set(application.id, {
      applicationId: application.id,
      eventId: application.eventId,
      founderId: application.founderId,
      decisions
    });
  }

  store.version += 1;
}

export function listLocalApprovalDecisionSnapshots(eventId?: string): LocalApprovalDecisionSnapshot[] {
  return [...localApprovalDecisionStore().records.values()]
    .filter((record) => !eventId || record.eventId === eventId)
    .map((record) => ({
      applicationId: record.applicationId,
      eventId: record.eventId,
      founderId: record.founderId,
      status: record.decisions[record.decisions.length - 1]?.status ?? "manual"
    }));
}

export function localApprovalDecisionVersion() {
  return localApprovalDecisionStore().version;
}

export function clearLocalApprovalDecisionsForTests() {
  const store = localApprovalDecisionStore();
  store.records.clear();
  store.version += 1;
}

function localApprovalDecisionStore(): LocalApprovalDecisionStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: LocalApprovalDecisionStore;
  };

  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = {
      records: new Map(),
      version: 0
    };
  }

  return globalStore[STORE_KEY];
}

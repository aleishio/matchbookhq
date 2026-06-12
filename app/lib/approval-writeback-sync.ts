import type { BulkApprovalResult } from "./event-approvals-repository";
import { LumaConfigurationError } from "./luma/client";
import {
  LumaWritebackWorkerConfigurationError,
  processImmediateLumaWritebacksFromEnv
} from "./luma/writeback-worker";
import type { LumaWritebackSummary } from "./luma/writebacks";
import { SupabaseConfigurationError } from "./supabase/service-client";

export async function runImmediateApprovalWritebackSync(
  result: BulkApprovalResult,
  env: NodeJS.ProcessEnv = process.env
): Promise<NonNullable<BulkApprovalResult["writebackSync"]>> {
  if (
    result.dryRun
    || (result.action !== "approve" && result.action !== "reject")
    || !result.operationId
    || !isUuid(result.operationId)
  ) {
    return { status: "skipped", claimed: 0, succeeded: 0, failed: 0 };
  }

  try {
    const summary = await withTimeout(
      processImmediateLumaWritebacksFromEnv(env, {
        batchSize: immediateWritebackBatchSize(result.appliedCount, env),
        workerId: `yc-os-immediate-${result.operationId}`,
        scope: { operationId: result.operationId }
      }),
      8_000
    );
    return syncStateForSummary(summary);
  } catch (error) {
    if (error instanceof WritebackTimeoutError) {
      return { status: "syncing", claimed: 0, succeeded: 0, failed: 0 };
    }
    if (
      error instanceof LumaConfigurationError
      || error instanceof SupabaseConfigurationError
      || error instanceof LumaWritebackWorkerConfigurationError
    ) {
      return { status: "not_configured", claimed: 0, succeeded: 0, failed: 0 };
    }

    return { status: "retrying", claimed: 0, succeeded: 0, failed: 1 };
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function immediateWritebackBatchSize(appliedCount: number, env: NodeJS.ProcessEnv) {
  const configured = Number.parseInt(env.LUMA_IMMEDIATE_WRITEBACK_BATCH_SIZE ?? "", 10);
  if (Number.isFinite(configured)) return Math.max(1, Math.min(configured, 100));
  return Math.max(1, Math.min(appliedCount, 20));
}

function syncStateForSummary(summary: LumaWritebackSummary): NonNullable<BulkApprovalResult["writebackSync"]> {
  if (summary.claimed === 0) return { status: "syncing", claimed: 0, succeeded: 0, failed: 0 };
  if (summary.failed > 0) {
    return {
      status: "retrying",
      claimed: summary.claimed,
      succeeded: summary.succeeded,
      failed: summary.failed
    };
  }

  return {
    status: summary.succeeded === summary.claimed ? "synced" : "syncing",
    claimed: summary.claimed,
    succeeded: summary.succeeded,
    failed: summary.failed
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new WritebackTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class WritebackTimeoutError extends Error {
  constructor() {
    super("Lu.ma writeback sync is still running.");
    this.name = "WritebackTimeoutError";
  }
}

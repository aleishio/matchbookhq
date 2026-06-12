import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/202606090001_event_approvals_foundation.sql"
);
const syncMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606090002_luma_sync_operations.sql"
);
const scopedWritebackMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606110001_scoped_luma_writeback_claims.sql"
);
const eventPrepMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100003_event_prep_foundation.sql"
);
const eventPrepExampleMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100004_event_prep_example_live_events.sql"
);
const aiInfraDefaultEventMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606120001_ai_infra_default_event.sql"
);
const eventAttendanceAgentUpsertKeyMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606120002_event_attendance_agent_upsert_key.sql"
);
const approvalEventPrepAnchorsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606120003_approval_event_prep_anchors.sql"
);
const emailReplyMappingIndexesMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100006_email_reply_mapping_indexes.sql"
);
const clarificationEmailCustomCopyMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100007_clarification_email_custom_copy.sql"
);
const resendReplyIdempotencyMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100008_resend_reply_idempotency.sql"
);
const clarificationEmailJobProcessingMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100009_clarification_email_job_processing.sql"
);
const agentGuestRequestsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606100010_agent_guest_requests.sql"
);
const agentNativeGuestRuntimeMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606110001_agent_native_guest_runtime.sql"
);
const scopedAgentGuestRequestClaimsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/202606110003_scoped_agent_guest_request_claims.sql"
);
const lumaWritebackEdgeFunctionPath = join(
  process.cwd(),
  "supabase/functions/luma-writebacks/index.ts"
);
const agentGuestRequestsEdgeFunctionPath = join(
  process.cwd(),
  "supabase/functions/agent-guest-requests/index.ts"
);
const clarificationEmailsEdgeFunctionPath = join(
  process.cwd(),
  "supabase/functions/clarification-emails/index.ts"
);

test("event approvals migration creates the durable backend tables", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const tableName of [
    "event_ops_members",
    "external_accounts",
    "luma_events",
    "luma_event_applications",
    "applicant_identity_matches",
    "applicant_source_comparisons",
    "applicant_ai_reviews",
    "approval_decisions",
    "approval_bulk_operations",
    "approval_bulk_operation_items",
    "luma_writeback_jobs",
    "clarification_email_jobs",
    "applicant_replies",
    "provider_webhook_events"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${tableName}`));
    assert.match(sql, new RegExp(`alter table public\\.${tableName} enable row level security`));
  }
});

test("event approvals migration preserves source comparison and AI decision constraints", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /approval_status in \('ready', 'needs_info', 'awaiting_reply', 'manual', 'waitlist', 'approved', 'rejected'\)/);
  assert.match(sql, /result in \('match', 'partial', 'missing', 'conflict', 'not_checked'\)/);
  assert.match(sql, /decision in \('approve', 'send_info', 'manual', 'waitlist', 'reject'\)/);
  assert.match(sql, /target_status in \('approved', 'declined', 'pending_approval', 'waitlist'\)/);
  assert.match(sql, /AI recommendations are advisory/);
});

test("luma sync migration adds operational safety for syncs and writebacks", () => {
  const sql = readFileSync(syncMigrationPath, "utf8");

  assert.match(sql, /create table if not exists public\.luma_sync_runs/);
  assert.match(sql, /add column if not exists synced_at timestamptz/);
  assert.match(sql, /add column if not exists last_seen_at timestamptz/);
  assert.match(sql, /add column if not exists idempotency_key text/);
  assert.match(sql, /create unique index if not exists luma_writeback_jobs_idempotency_key_idx/);
  assert.match(sql, /create or replace function public\.queue_luma_approval_action/);
  assert.match(sql, /create or replace function public\.claim_luma_writeback_jobs/);
  assert.match(sql, /rec\.luma_fields->>'guest_api_id'/);
  assert.match(sql, /jsonb_build_object\('type', 'email', 'email', rec\.applicant_email\)/);
  assert.match(sql, /claimed\.payload#>>'\{guest,email\}'/);
  assert.match(sql, /for update skip locked/);
});

test("luma writeback claim migration supports scoped immediate syncs", () => {
  const sql = readFileSync(scopedWritebackMigrationPath, "utf8");

  assert.match(sql, /p_bulk_operation_id uuid default null/);
  assert.match(sql, /p_job_ids uuid\[\] default null/);
  assert.match(sql, /job\.bulk_operation_id = p_bulk_operation_id/);
  assert.match(sql, /job\.id = any\(p_job_ids\)/);
  assert.match(sql, /for update skip locked/);
});

test("event prep migration creates durable YC public-data tables", () => {
  const sql = readFileSync(eventPrepMigrationPath, "utf8");

  for (const tableName of [
    "yc_events",
    "yc_companies",
    "yc_founders",
    "yc_event_attendance",
    "yc_founder_needs",
    "yc_notes",
    "yc_intro_suggestions"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${tableName}`));
    assert.match(sql, new RegExp(`alter table public\\.${tableName} enable row level security`));
  }

  assert.match(sql, /primary key \(event_id, founder_id\)/);
  assert.match(sql, /fit_label in \('strong', 'good', 'check'\)/);
  assert.match(sql, /Do not import private office-hours data/);
});

test("event prep example migration marks example and live event selector rows", () => {
  const sql = readFileSync(eventPrepExampleMigrationPath, "utf8");

  assert.match(sql, /w26-founder-mixer-example/);
  assert.match(sql, /'display_kind', 'example'/);
  assert.match(sql, /'display_kind', 'live'/);
  assert.match(sql, /'display_kind', 'hidden'/);
  assert.match(sql, /dogpatch-founder-breakfast/);
});

test("ai infra default event migration marks Supabase approval and prep defaults", () => {
  const sql = readFileSync(aiInfraDefaultEventMigrationPath, "utf8");

  assert.match(sql, /update public\.luma_events/);
  assert.match(sql, /ai-infra-office-hours/);
  assert.match(sql, /AI Infra Office Hours in SF/);
  assert.match(sql, /'primary_event', true/);
  assert.match(sql, /'default_for', jsonb_build_array\('approvals', 'event_prep'\)/);
  assert.match(sql, /'default_rank', 0/);
  assert.match(sql, /'primary_approval_event_id'/);
});

test("event attendance migration supports agent upserts", () => {
  const sql = readFileSync(eventAttendanceAgentUpsertKeyMigrationPath, "utf8");

  assert.match(sql, /idx\.indisunique/);
  assert.match(sql, /array\['event_id', 'founder_id'\]/);
  assert.match(sql, /create unique index yc_event_attendance_event_founder_uidx/);
  assert.match(sql, /on public\.yc_event_attendance\(event_id, founder_id\)/);
});

test("approval event prep anchor migration backfills YC event rows", () => {
  const sql = readFileSync(approvalEventPrepAnchorsMigrationPath, "utf8");

  assert.match(sql, /insert into public\.yc_events/);
  assert.match(sql, /from public\.luma_events event/);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /agent_write_anchor/);
});

test("email reply mapping migration indexes per-application lookups", () => {
  const sql = readFileSync(emailReplyMappingIndexesMigrationPath, "utf8");

  assert.match(sql, /clarification_email_jobs_application_created_idx/);
  assert.match(sql, /on public\.clarification_email_jobs\(application_id, created_at desc\)/);
  assert.match(sql, /applicant_replies_application_created_idx/);
  assert.match(sql, /on public\.applicant_replies\(application_id, created_at desc\)/);
  assert.match(sql, /applicant_replies_ai_review_id_idx/);
  assert.match(sql, /where ai_review_id is not null/);
});

test("clarification email migration stores optional user-authored copy", () => {
  const sql = readFileSync(clarificationEmailCustomCopyMigrationPath, "utf8");

  assert.match(sql, /drop function if exists public\.queue_luma_approval_action\(uuid\[\], text, uuid, text, text, jsonb, boolean\)/);
  assert.match(sql, /p_email_payload jsonb default '\{\}'::jsonb/);
  assert.match(sql, /v_email_subject := left\(/);
  assert.match(sql, /v_email_body := left\(/);
  assert.match(sql, /'subject', v_email_subject/);
  assert.match(sql, /'body', v_email_body/);
  assert.match(sql, /'body_preview', v_email_body/);
  assert.match(sql, /and approval_status = rec\.approval_status/);
  assert.match(sql, /approval status changed before action could be applied/);
  assert.match(sql, /Optional user-authored clarification email copy/);
  assert.match(sql, /revoke all on function public\.queue_luma_approval_action\(uuid\[\], text, uuid, text, text, jsonb, boolean, jsonb\) from public/);
  assert.match(sql, /grant execute on function public\.queue_luma_approval_action\(uuid\[\], text, uuid, text, text, jsonb, boolean, jsonb\) to authenticated, service_role/);
});

test("resend reply idempotency migration protects replayed inbound emails", () => {
  const sql = readFileSync(resendReplyIdempotencyMigrationPath, "utf8");

  assert.match(sql, /applicant_replies_provider_message_id_unique_idx/);
  assert.match(sql, /on public\.applicant_replies\(provider_message_id\)/);
  assert.match(sql, /where provider_message_id is not null/);
  assert.match(sql, /clarification_email_jobs_to_email_created_idx/);
  assert.match(sql, /on public\.clarification_email_jobs\(lower\(to_email\), created_at desc\)/);
  assert.match(sql, /clarification_email_jobs_resend_email_id_idx/);
  assert.match(sql, /Makes Resend inbound reply ingestion idempotent/);
});

test("clarification email processing migration adds a retryable claim function", () => {
  const sql = readFileSync(clarificationEmailJobProcessingMigrationPath, "utf8");

  assert.match(sql, /add column if not exists locked_at timestamptz/);
  assert.match(sql, /add column if not exists locked_by text/);
  assert.match(sql, /add column if not exists response_payload jsonb/);
  assert.match(sql, /create or replace function public\.claim_clarification_email_jobs/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /status = 'running'/);
  assert.match(sql, /attempt_count = job\.attempt_count \+ 1/);
  assert.match(sql, /grant execute on function public\.claim_clarification_email_jobs\(integer, text\) to service_role/);
});

test("agent guest request migration stores internal agent action requests", () => {
  const sql = readFileSync(agentGuestRequestsMigrationPath, "utf8");

  assert.match(sql, /create table if not exists public\.agent_guest_requests/);
  assert.match(sql, /action text not null check \(action in \('event_guests\.add'\)\)/);
  assert.match(sql, /event_kind text not null check \(event_kind in \('real', 'demo'\)\)/);
  assert.match(sql, /guest_adds text not null check \(guest_adds in \('available', 'dry_run_only'\)\)/);
  assert.match(sql, /status text not null default 'pending' check \(status in \('dry_run', 'pending', 'running', 'sent_to_luma', 'failed', 'blocked'\)\)/);
  assert.match(sql, /attempt_count integer not null default 0/);
  assert.match(sql, /locked_at timestamptz/);
  assert.match(sql, /guests jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /alter table public\.agent_guest_requests enable row level security/);
  assert.match(sql, /event ops can read agent guest requests/);
  assert.match(sql, /event ops can write agent guest requests/);
  assert.match(sql, /create or replace function public\.claim_agent_guest_requests/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /grant execute on function public\.claim_agent_guest_requests\(integer, text\) to service_role/);
});

test("agent-native guest runtime migration claims scoped clarification email jobs", () => {
  const sql = readFileSync(agentNativeGuestRuntimeMigrationPath, "utf8");

  assert.match(sql, /create or replace function public\.claim_clarification_email_jobs_for_operation/);
  assert.match(sql, /p_operation_id uuid/);
  assert.match(sql, /job\.bulk_operation_id = p_operation_id/);
  assert.match(sql, /job\.status in \('queued', 'failed'\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /status = 'running'/);
  assert.match(sql, /grant execute on function public\.claim_clarification_email_jobs_for_operation\(uuid, integer, text\) to service_role/);
});

test("scoped agent guest request migration claims one MCP-created request", () => {
  const sql = readFileSync(scopedAgentGuestRequestClaimsMigrationPath, "utf8");

  assert.match(sql, /create or replace function public\.claim_agent_guest_requests/);
  assert.match(sql, /p_request_id uuid default null/);
  assert.match(sql, /p_request_id is null or request\.id = p_request_id/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /comment on function public\.claim_agent_guest_requests\(integer, text, uuid\)/);
  assert.match(sql, /grant execute on function public\.claim_agent_guest_requests\(integer, text, uuid\) to service_role/);
});

test("supabase luma writeback function claims scoped jobs and updates provider status", () => {
  const source = readFileSync(lumaWritebackEdgeFunctionPath, "utf8");

  assert.match(source, /claim_luma_writeback_jobs/);
  assert.match(source, /p_bulk_operation_id: scope\?\.operationId/);
  assert.match(source, /\/v1\/event\/update-guest-status/);
  assert.match(source, /luma_writeback_jobs/);
  assert.match(source, /x-luma-api-key/);
});

test("supabase agent guest request function claims scoped requests and adds guests", () => {
  const source = readFileSync(agentGuestRequestsEdgeFunctionPath, "utf8");

  assert.match(source, /claim_agent_guest_requests/);
  assert.match(source, /p_request_id: requestId/);
  assert.match(source, /\/v1\/event\/add-guests/);
  assert.match(source, /agent_guest_requests/);
  assert.match(source, /x-luma-api-key/);
});

test("supabase clarification email function claims scoped operations and sends through Resend", () => {
  const source = readFileSync(clarificationEmailsEdgeFunctionPath, "utf8");

  assert.match(source, /claim_clarification_email_jobs_for_operation/);
  assert.match(source, /p_operation_id: operationId/);
  assert.match(source, /https:\/\/api\.resend\.com\/emails/);
  assert.match(source, /clarification_email_jobs/);
  assert.match(source, /RESEND_API_KEY/);
});

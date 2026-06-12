# Agent Instructions

This repo must remain safe to publish publicly.

## Data

- Use public data only.
- Keep private credentials, private company notes, and raw operational logs out of the repo.
- Record public source URLs and retrieval timestamps for imported data.

## Secrets

- Never read, print, commit, or summarize real env values.
- Never commit `.env`, `.env.development`, `.env.local`, or `.vercel`.
- Use `.env.example` for variable names only.
- If a secret appears in chat, terminal output, logs, or git history, tell the user to rotate it.

## gbrain

Agents must decide automatically when to use gbrain. The user should not need to remember this.

Query gbrain before:

- large planning, refactors, debugging, schema design, or architecture work
- starting a Paperclip issue with existing context likely to matter
- making decisions that depend on prior project direction

Capture a short public-safe memory after:

- architecture or product decisions
- security policy decisions
- completed setup/configuration work that future agents should know
- reusable research summaries with source URLs and retrieval dates

Do not capture raw transcripts, secrets, private logs, `.env` values, credentials, or private company data.
Use concise summaries, not full conversation dumps.

Use Voyage embeddings and Supabase storage for the shared dev brain.

## Design

- Read `DESIGN.md` before changing UI, layout, interaction behavior, or product copy.
- Use `docs/design-system.md` for concrete component, spacing, color, and browser QA rules.
- Keep YC OS as a quiet event-prep tool, not a marketing site.
- Do not add landing pages, decorative gradients, excessive cards, percentage intro scores, or repeated metadata pills.

## Supabase

- Use the installed Supabase skills for Supabase work.
- Prefer Supabase MCP for docs/search/schema inspection when available.
- Use the Supabase Session Pooler URL for gbrain, never the direct DB URL.
- Enable RLS on all exposed schemas.
- Treat `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as browser-visible.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

## Paperclip

Paperclip is installed and onboarded for local development.

- Company: `YC OS`
- Project: `YC OS Apps`
- Primary issue: `YCO-1`

Paperclip IDs and local API exports are local operator state. Do not commit
them or copy them into public docs. Paperclip agents use the same
public-data-only rules as Codex and Claude. They should automatically query and
capture gbrain context using the gbrain rules above.

## Shipping

- Use PRs.
- Prefer Vercel preview deployments before production.
- Run tests and review diffs before merge.
- Do not bypass failing CI.

# CLAUDE.md

## Project Posture

This repo is public-by-default. Assume all committed code, docs, examples, and config names will become public.

## Skill Routing

When the user's request matches an available gstack skill, invoke it.

- Bugs/errors -> `/investigate`
- QA/testing site behavior -> `/qa` or `/qa-only`
- Code review/diff check -> `/review`
- Ship/deploy/PR -> `/ship` or `/land-and-deploy`
- Configure deploys -> `/setup-deploy`
- Configure shared brain -> `/setup-gbrain`
- Refresh brain index -> `/sync-gbrain`
- Save progress -> `/context-save`
- Resume context -> `/context-restore`

## Deploy Configuration

- Platform: Vercel
- Production URL: pending Vercel project URL
- Preview deploys: Vercel GitHub integration
- Deploy workflow: auto-deploy on merge
- Deploy status command: Vercel dashboard or GitHub deployment status
- Post-deploy health check: pending `/api/health`

## GBrain Plan

- Storage: Supabase Postgres Session Pooler
- Embeddings: Voyage
- Model: `voyage-code-3`
- Config file: `~/.gbrain/config.json`
- Public-data-only memory policy
- Status: initialized on the dev VPS

Codex, Claude, and Paperclip agents must decide automatically when to use gbrain.
The user should not need to remember to ask for it.

Query gbrain before large planning, refactor, debugging, schema design, architecture work, and Paperclip issues with existing context likely to matter.

Capture a short public-safe memory after durable decisions, completed setup/configuration work, security policy decisions, and reusable public research summaries.

Never capture raw transcripts, secrets, private logs, `.env` values, credentials, or private company data. Prefer concise summaries.

## Design Source

Read `DESIGN.md` before UI, layout, interaction, or product copy work.

Use `docs/design-system.md` for concrete component, spacing, color, responsive, and browser QA rules. YC OS should stay a quiet event-prep tool, not a marketing site. Do not add landing pages, decorative gradients, excessive cards, percentage intro scores, or repeated metadata pills.

## Paperclip Configuration

- Status: installed and onboarded for local development
- Primary issue: `YCO-1`
- Project root: local checkout
- Data policy: public data only
- Shared memory target: gbrain

Paperclip IDs and local API exports are local operator state. Do not commit
them or copy them into public docs.

Paperclip agents should automatically query and capture gbrain context using the GBrain Plan rules above.

## Supabase Configuration

- MCP server: `supabase`
- Project ref: configured locally outside the repo
- Skills installed:
  - `.agents/skills/supabase`
  - `.agents/skills/supabase-postgres-best-practices`

Use Supabase MCP and the installed Supabase skills for database/storage/auth work. Enable RLS on exposed schemas.

Use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for browser-visible Supabase clients.

## Security

- Never expose secrets.
- Never print full API keys, tokens, passwords, database URLs, or pooler URLs.
- Do not place production credentials on the AI dev VPS.

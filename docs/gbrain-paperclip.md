# gbrain + Paperclip

Target architecture:

```text
Paperclip agents + Codex + Claude
        |
      gbrain
        |
Supabase Session Pooler + Voyage embeddings
```

## Current Status

Completed:

- Supabase MCP registered in Codex.
- Supabase MCP OAuth login completed.
- Supabase agent skills installed.
- Voyage key is present in the local dev env.
- Supabase Session Pooler URL is configured for gbrain.
- gbrain is initialized with Supabase storage and Voyage embeddings.
- gbrain MCP is registered for Codex and Claude.
- Paperclip is running locally at `http://127.0.0.1:3100`.
- Paperclip company, project, agents, and issue `YCO-1` are created locally.
- Codex Engineer local Paperclip exports are stored outside the repo.

Paperclip IDs are local operator state. Keep them out of public docs and use
the local Paperclip UI or export files when an operator needs the actual IDs.

## Required Local Env Values

These stay outside the repo:

```text
VOYAGE_API_KEY
GBRAIN_SUPABASE_POOLER_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Use the Supabase Session Pooler URL on port `6543`. Do not use the direct database URL.

The local Paperclip Codex Engineer exports stay outside the repo:

```text
$YC_OS_SECRETS_DIR/paperclip-codex-engineer.env
```

## Agent Rule

gbrain is not a raw automatic transcript recorder. It is shared project memory.

Agents are responsible for deciding when to use it automatically.

Query gbrain before:

- large planning, refactor, debugging, schema design, or architecture work
- starting a Paperclip issue where prior context may matter
- making decisions that depend on prior project direction

Capture a short public-safe memory after:

- durable architecture or product decisions
- security policy decisions
- completed setup/configuration work future agents should know
- reusable public research summaries with source URLs and retrieval dates

Do not capture:

- raw transcripts
- secrets or `.env` values
- private logs
- credentials
- private company data

Use concise summaries. Do not dump full conversations.

If gbrain is temporarily unavailable, proceed with local repo search and note that shared memory could not be queried.

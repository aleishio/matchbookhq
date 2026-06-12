# Matching V1

`lib/matching.ts` contains the deterministic intro logic for the event-prep V1. It is pure: pass founder-like records in, get intro suggestion DTOs out. It does not read files, call APIs, mutate records, or depend on UI state.

## API

```ts
import {
  scoreFounderPair,
  suggestIntros,
  suggestIntrosForFounder,
  type FounderForMatching,
  type IntroSuggestion,
} from "@/lib/matching";
```

### `FounderForMatching`

The matcher accepts normalized seed records or DTOs with these useful fields:

- `id`, `name`
- `company_id`, `company_name`
- `category`, `stage`, `batch`
- `one_liner`
- `need_text` or `ask`
- optional `tags`, `keywords`, `gtm_motion`, `workflow`

Missing optional fields are safe. More complete records produce better evidence.

### `IntroSuggestion`

The returned shape matches the V1 data model:

```ts
type IntroSuggestion = {
  from_founder_id: string;
  to_founder_id: string;
  fit_label: "strong" | "good" | "check";
  reason: string;
  opener: string;
  caution: string | null;
  evidence: Array<{
    kind:
      | "category"
      | "need_keyword"
      | "workflow"
      | "ai_infra"
      | "text_overlap"
      | "caution";
    label: string;
    detail: string;
    weight: number;
  }>;
};
```

No percentages are exposed. `weight` is included only to explain the deterministic rule contribution in expandable context.

## Rules

The scorer rewards:

- same or adjacent categories
- explicit need keyword overlap for fundraising, design partners, GTM, AI evals, and hardware sales cycle
- GTM/workflow overlap such as sales, recruiting, healthcare, devtools, security, finance, education, logistics, support, and analytics
- AI infra and AI evals overlap
- small shared-language overlap as a tie breaker

The scorer cautions:

- same-company pairs: emitted as `check` context by default, not a new intro
- weak deterministic matches with no category, need, or workflow evidence
- category mismatch where only weak overlap exists

Use `include_same_company_context: false` to suppress same-company context rows.

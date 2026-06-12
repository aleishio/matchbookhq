# Design System

This document expands `DESIGN.md` into concrete UI guidance for implementation.

## Design Goal

YC OS should help an event/community team scan a founder room before making introductions. The UI must optimize for fast recognition, prep, and judgment.

Good design here is not decorative. It is:

- faster founder recognition
- fewer duplicate facts
- clear ask and intro context
- visible cautions
- easy note capture
- predictable paging and search

## Layout

Use a two-pane workspace on desktop:

- Left: founder directory, fixed-width around `430px`.
- Right: selected founder detail, flexible width.
- Top: persistent header and toolbar.

Use a single-column stack on smaller screens:

- Toolbar wraps.
- Directory appears above detail.
- Directory can use a constrained height so the selected detail remains reachable.

Avoid side rails unless they are critical to the current workflow. The current product does not need a metrics rail.

## Header

Header contents:

- YC mark
- event title
- founder count and time
- data/source status

Keep it compact. The header is context, not the main content.

## Toolbar

Toolbar contents:

- `Event prep` label
- lenses: `All`, `Suggested intros`, `Caution`, `AI infra`
- search input
- pagination range and controls

Pagination belongs top-right. Do not put paging only below the directory.

Lenses should be low-friction chips. Do not add complex filter builders until there is a real event-team workflow for them.

## Founder Directory

Each row should show:

- founder photo
- founder name
- company and stage
- current need
- category
- intro/caution signal

Rules:

- 25 founders per page.
- Preserve row height and alignment.
- Truncate long needs gracefully.
- Keep photos visible and circular.
- Active row gets an orange left edge.
- Rows are buttons and must have visible focus states.

Do not show all possible metadata in the row. The row is for selection, not full analysis.

## Founder Detail

Top area:

- large founder photo
- founder name
- one merged metadata line: company, stage, category, location

Sections:

1. `Ask`
2. `Intro`
3. `Notes`

The founder detail should not duplicate metadata that already appears in the header line.

## Ask

Ask is the current problem, need, or request. It should be readable at a glance.

Keep it in plain text. Do not bury it in a card header, tooltip, or hidden section.

## Intro

Intro is a recommendation, not a command.

Show:

- source founder photo and first name
- target founder photo and first name
- target founder name and company
- fit label: `strong`, `good`, or `check`
- concise reason
- conversation opener
- expandable context/caution

Use `More context` for:

- caution
- sensitive context
- evidence tags
- "test the water" guidance

Do not use percentages. They imply false precision.

## Notes

Notes should include:

- Office hours
- Founder note
- Room note
- Local note

Local notes are currently client state. Backend persistence is covered in `docs/supabase-backend-integration.md`.

Do not render empty office-hours placeholders when there is no content. Empty states should be short and useful.

## Color

Use the current app palette as the baseline:

```css
:root {
  --bg: #fafaf7;
  --surface: #f5f5f0;
  --row: #fff;
  --hover: #f0efe8;
  --border: #e2e1d9;
  --text: #111;
  --secondary: #555;
  --muted: #888;
  --orange: #ff6600;
  --orange-soft: #fff0e6;
  --caution: #92400e;
  --caution-bg: #fef3c7;
  --ai: #2f5f46;
  --ai-bg: #edf7ef;
}
```

Orange is for identity, active state, focus, and high-priority action. It should not flood the interface.

Use green only for AI/positive-context signals, and amber/brown only for caution.

## Type

Use system UI fonts unless a brand decision changes this.

Guidance:

- Body: 15px.
- Directory supporting text: 12px.
- Labels: small uppercase, heavier weight, slight positive letter spacing.
- Detail heading: around 28px.
- Ask text: around 18px.

Do not use hero-scale type inside the app surface.

## Spacing And Shape

Use compact spacing:

- toolbar gap: 8-10px
- row padding: 10-14px
- detail padding: 28-32px desktop
- section top margin: around 22px
- section divider: 1px neutral border

Use low radius:

- chips/buttons: 2-3px
- framed intro/notes: 4px
- cards should stay 8px or lower if introduced later

## Responsive Rules

At tablet/mobile widths:

- toolbar wraps cleanly
- search gets enough width to type
- pagination remains visible
- directory stacks above detail
- no horizontal scroll
- text must not overlap buttons or images

If a long category or company name does not fit, truncate it rather than expanding the row unpredictably.

## Accessibility

Baseline requirements:

- rows are keyboard-focusable buttons
- visible focus outline uses YC orange
- images have founder names as alt text
- search has an accessible label
- pagination buttons have disabled states
- contrast remains readable on muted backgrounds

Do not remove semantic labels to make the DOM look cleaner.

## Browser QA

Use gstack browse on this VPS with the platform override:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse goto http://127.0.0.1:3000
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse console --errors
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse screenshot /tmp/yc-os-qa.png
```

Expected smoke behavior:

- no console errors
- page title and founder count visible
- images have nonzero natural dimensions
- `Next` changes the range
- search narrows the range
- add-note creates a visible local note

Run `npm run typecheck`, `npm test`, and `npm run build` before shipping UI changes.

## Change Review Checklist

Before merging UI work, verify:

- The first screen is the tool, not a landing page.
- Founder photo remains visible in rows and detail.
- Ask, Intro, and Notes remain the core detail order.
- Metadata is not duplicated.
- Filters are still simple and useful.
- Pagination is understandable.
- Intro includes both founder photos.
- Caution/sensitive context is present but not noisy.
- Notes can be added locally.
- Text does not overlap at desktop or mobile widths.
- Browser QA screenshot is attached or path is recorded.

# YC OS Design Principles

This is the canonical design source for YC OS. Read this before changing UI, layout, interaction behavior, or copy.

## Product Shape

YC OS is an event-prep tool for founder/community teams. It is not a marketing site.

The user is preparing for a room full of founders. They need to scan who is coming, remember what each person needs, and make good in-person introductions. The app should feel like a quiet internal operating surface: dense, calm, fast, and built for repeated use before and during an event.

The product value is:

- founder context first
- useful intro suggestions second
- AI as support for human taste, not a replacement for it
- notes and cautions visible enough to prevent bad intros

## Visual Direction

Use a YC-inspired operational interface:

- warm off-white background
- white rows and panels
- thin neutral borders
- YC orange as the primary accent
- black primary text
- muted gray secondary text
- compact controls
- low-radius UI

The interface should feel closer to YC's company directory and internal ops tooling than to a SaaS landing page.

## Current Canonical Screen

The first screen is the event prep workspace:

- Top bar: YC mark, event title, founder count, event time, source status.
- Toolbar: event prep lenses, search, and pagination in the top-right.
- Left directory: 25 founders per page, founder photo, name, company, stage, need, category, intro/caution signal.
- Right detail panel: selected founder photo, name, merged metadata line, ask, intro, notes.

The right panel order is:

1. Founder identity
2. Ask
3. Intro
4. Notes

Do not reintroduce a separate context section. The useful context belongs inside Intro and Notes.

## Interaction Rules

Directory:

- Page by 25 founders.
- Keep pagination at the top-right of the toolbar.
- Show the range as `Showing 1-25 of 415 founders`.
- Search resets to page 1.
- Filters/lenses should help prep, not become analytics. Keep them few.

Founder detail:

- Founder photo must be large enough to recognize someone in a room.
- Keep one metadata line under the name. Do not repeat stage, batch, category, and location as separate pills below.
- Ask should be prominent and readable.
- Notes should be directly below Intro.
- Local notes should be possible, but persistence requires the backend work in `docs/supabase-backend-integration.md`.

Intro:

- Show photos for both people in the intro.
- Use plain language: who to connect, why, and an opener.
- Caution or sensitive context belongs in expandable "More context".
- Avoid percentage scores. Use human labels such as `strong`, `good`, and `check`.
- Not every founder needs an intro. Empty intro state should be calm and useful.

## Copy Rules

Use direct event-ops language:

- "Ask"
- "Intro"
- "Notes"
- "More context"
- "Suggested intros"
- "Caution"

Avoid explaining how to use the product in the UI. The user should understand the screen through layout and labels.

Avoid marketing language, generic AI copy, and inflated claims.

## Do Not Regress

Do not add:

- landing pages before the tool
- hero sections
- decorative gradients or blobs
- excessive cards
- card/list view toggles
- repeated metadata pills
- percentage match scores
- many filters that do not help decide who to meet
- empty office-hours blocks
- visible tutorials or feature explanations

Do not make the UI visually dominated by one heavy color family. YC orange is an accent, not a background theme.

## Implementation Rules

- Keep page sections unframed unless they are repeated rows, modals, or genuinely framed tools.
- Use 8px radius or lower.
- Keep text within containers at mobile and desktop widths.
- Use stable dimensions for rows, avatars, toolbars, counters, and buttons.
- Do not scale font size with viewport width.
- Keep letter spacing at `0` except small uppercase labels.
- Prefer actual founder/company images over abstract visuals.
- Use icons only where they clarify an action; do not replace clear text labels like `Ask`, `Intro`, or `Notes`.

## QA Rule

On this VPS, run gstack browser QA with:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse goto http://127.0.0.1:3000
```

Minimum UI checks:

- page loads with no console errors
- founder images render
- pagination moves from `Showing 1-25` to `Showing 26-50`
- search narrows the list
- founder selection updates the detail panel
- intro "More context" expands
- add-note creates a local note and clears the draft

Long term, Docker or CI Playwright is the reproducible browser QA path.

## Related Docs

- Detailed design system: `docs/design-system.md`
- Browser QA alternatives: `docs/browser-qa-alternatives.md`
- Supabase/backend continuation: `docs/supabase-backend-integration.md`
- Matching behavior: `docs/matching.md`
- Notes model: `docs/notes.md`

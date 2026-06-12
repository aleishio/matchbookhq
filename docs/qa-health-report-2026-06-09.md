# YC OS QA and Health Report

Date: 2026-06-09

## Scope

Run the requested gstack-style checks for the YC Winter 2026 event-prep prototype:

- `/qa`: live smoke test of the app, rendered content, static assets, and obvious runtime failures.
- `/health`: typecheck, tests, build, dependency advisory check.
- `/design-review`: source and rendered-output review of the current UI constraints, with browser screenshot testing attempted.
- Supabase read-only check: verify whether the extracted YC batch data is already stored in Supabase.

## Supabase Status

The YC Winter 2026 data is not currently saved in Supabase.

Current app data source:

- `data/seed.json` - normalized event, company, founder, need, note, and asset metadata.
- `data/*.json` - extracted source slices.
- `public/founders/winter-2026/**` - local founder/company images served by Next.js.
- `app/lib/event-prep-data.ts` - reads the local seed file and adapts it for the UI.

Read-only Supabase checks:

- `public` schema has no `founders`, `companies`, `events`, `intros`, `notes`, or `yc` tables.
- Matching table-name query only returned `gbrain_cycle_locks`.
- Existing Supabase tables look like a gbrain/content schema, not this YC event-prep app.
- No migrations are listed in the connected Supabase project.

Conclusion: Supabase is configured/documented in the repo, but this prototype is local JSON plus local assets. A Supabase migration is still a future step if we want persistent notes, multi-user editing, auth, or event operations.

## Checks Run

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
curl http://127.0.0.1:3000
curl http://127.0.0.1:3000/founders/winter-2026/10x-science/05_founder_avatar_3196415_andrew-reiter.jpg
npx playwright install chromium
```

## Results

- Typecheck: pass.
- Matching tests: pass, 5 tests.
- Production build: pass.
- Homepage smoke test: pass, `200 OK`.
- Rendered markers: pass, includes `YC Winter 2026 Event Prep`, `Showing 1-25 of 415 founders`, `Andrew Reiter`, search, intro details, and note controls.
- Founder image smoke test: pass, `200 OK`.
- Static route: pass, `/` is now prerendered by Next.js.
- Browser screenshot QA: initially blocked by VPS OS support, then verified with `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`.

## Fix Applied During QA

Issue found:

- The running app returned `500 Internal Server Error` after rebuilding while `next start` was still serving the previous `.next` build.
- The route was also set to `force-dynamic`, causing expensive per-request work over the full 415-founder dataset.

Fix:

- Changed `app/page.tsx` from `force-dynamic` to `force-static`.
- Added an in-process cache to `getEventPrepData()`.
- Rebuilt and restarted the production server.

Result:

- Homepage response improved from roughly `6-7s` to roughly `0.23s` locally.
- Static image response was roughly `0.11s`.
- Response headers now show `x-nextjs-cache: HIT` and `x-nextjs-prerender: 1`.

## Remaining Risks

- Initial HTML is still large at roughly `931 KB` because all 415 founders, notes, intro metadata, and image paths are serialized into the page.
- Browser-based visual QA depends on the Playwright platform override on this VPS. This is practical for local QA, but Docker/CI remains the reproducible path.
- `npm audit` reports two moderate advisories through Next/PostCSS. The suggested `npm audit fix --force` would install an incompatible old Next version, so do not apply it blindly.
- Notes added in the UI are local React state only. They are not persisted after refresh.

## Browser QA Update

Later on 2026-06-09, gstack browse was verified on this Ubuntu 26.04 VPS with:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse
```

Verified browser flow:

- loaded `http://127.0.0.1:3000`
- no console errors after a clean reload
- founder images rendered
- `Next` pagination changed the range to `Showing 26-50 of 415 founders`
- search for `Aemon` narrowed the list to `Showing 1-2 of 2 founders`
- local add-note UI created `QA override test note` and cleared the draft field
- screenshot saved to `/tmp/yc-os-override-qa-after-note.png`

## Recommended Next Steps

1. Add Supabase schema and import pipeline for `events`, `companies`, `founders`, `attendance`, `founder_needs`, `notes`, `intro_suggestions`, and `assets`.
2. Move note creation to a server action or API route backed by Supabase.
3. Replace all-data page serialization with server-backed pagination/search or an API route that loads founder pages on demand.
4. Keep using the platform override for local browser QA, then move to Docker/CI Playwright for reproducible visual QA.

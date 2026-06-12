# Browser QA Alternatives

Date: 2026-06-09

## What Failed

The gstack browser could not start because Playwright could not find or install its packaged Chromium build:

```text
Executable doesn't exist at <playwright-cache>/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell
Playwright does not support chromium on ubuntu26.04-x64
```

This does not mean Chromium as a browser is unusable forever. It means Playwright's managed Chromium package is not available for this VPS operating-system target.

## Current Best Local Option: Platform Override

The Playwright host platform override works on this VPS:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse status
```

Use the same environment variable for every gstack browse command:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse goto http://127.0.0.1:3000
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse snapshot -C
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 gstack browse screenshot /tmp/yc-os-qa.png
```

Verified on 2026-06-09:

- gstack browse daemon starts healthy with the override.
- `goto http://127.0.0.1:3000` returns `200`.
- YC app renders `YC Winter 2026 Event Prep`.
- Pagination works: `Next` changes the directory to `Showing 26-50 of 415 founders`.
- Search works: `Aemon` narrows the directory to `Showing 1-2 of 2 founders`.
- Add-note UI works for local state and clears the draft field.
- Founder images render with natural dimensions.
- Clean reload had no browser console errors.
- Screenshot artifact was written to `/tmp/yc-os-override-qa-after-note.png`.

This is an unsupported compatibility override, so keep Docker/CI as the long-term reproducible route. It is still good enough for local gstack `/qa` and `/design-review` on this VPS.

## Current QA Fallback

If the override stops working, use:

- `npm run typecheck`
- `npm test`
- `npm run build`
- HTTP smoke checks with `curl`
- source review for React state, pagination, filtering, and data flow
- manual browser inspection through Cursor/VPS port forwarding

This is enough for backend and data work, but it is not enough for final UI confidence. Visual regressions, responsive layout bugs, and client-side interaction bugs need a real browser. Since the platform override works, use gstack browse locally before falling back to manual-only UI checks.

## Preferred Option: Playwright In A Supported Container

For long-term reproducibility, run browser QA inside an official Playwright Docker image based on a supported OS, while the app runs on the VPS.

Shape:

```text
host Next.js app: http://127.0.0.1:3000
browser container: Playwright image with Chromium installed
tests/screenshots: written back to the repo or /tmp
```

Why this is best:

- Keeps the VPS OS unchanged.
- Gives reproducible browser binaries.
- Works for Chromium screenshots, responsive screenshots, and interaction tests.
- Can later move directly into CI.

Implementation notes for later:

1. Start the app on `0.0.0.0:3000`.
2. Run a Playwright container on the same Docker network or with host networking.
3. Store screenshots under `qa-artifacts/` or `/tmp/yc-os-qa/`.
4. Add a small smoke suite for:
   - page load
   - search
   - lens switching
   - next/previous paging
   - founder selection
   - intro details expansion
   - add-note UI behavior

## Option 2: Use A Supported QA Host

Run gstack browser or Playwright from:

- a local laptop
- another VPS on Ubuntu 24.04 LTS or Debian 12
- a CI runner with Playwright support

Point it at the forwarded app URL.

This is operationally simple if the app is already reachable through Cursor port forwarding or a temporary preview URL.

## Option 3: Remote Browser Over CDP

Use a browser running somewhere else and connect over Chrome DevTools Protocol.

Good when:

- the app must stay on this VPS
- we want to watch the browser in real time
- the remote machine already has Chrome/Chromium installed

Tradeoff:

- More setup than Docker.
- Less reproducible than a pinned Playwright image.

## Option 4: Hosted Browser Service

Use a hosted browser service such as a remote Playwright or browserless-style endpoint.

Good when:

- Docker is unavailable
- CI is not set up
- we need screenshots quickly

Tradeoff:

- External dependency.
- Must be careful not to send private data, secrets, or private notes to a third-party browser.

## Option 5: System Chrome Or Chromium

Install a system Chrome/Chromium package and point Playwright or Puppeteer at that executable.

Good when:

- package installation is allowed
- a compatible browser package exists for the OS

Tradeoff:

- Less reproducible.
- Some Playwright features can differ from the managed browser package.
- Still may fail if the system package is unavailable for Ubuntu 26.04.

## Option 6: Change The VPS Base Image

Move the workspace to Ubuntu 24.04 LTS or Debian 12.

Good when:

- this prototype becomes long-lived
- we want gstack `/qa`, `/design-review`, screenshots, and browser automation to work without special setup

Tradeoff:

- Highest infrastructure disruption.

Do not try to downgrade Ubuntu 26.04 to 24.04 in place. Treat this as a rebuild or new VPS:

1. Snapshot the current VPS from the hosting provider panel.
2. Save the working repo state or push it to a remote branch.
3. Preserve server-only secrets outside git:
   - `$YC_OS_SECRETS_DIR/**`
   - any provider env vars
   - any MCP credentials that are not reproducible
4. Create a new VPS from Ubuntu 24.04 LTS.
5. Install runtime basics:
   - Node.js
   - npm
   - Bun
   - git
6. Clone or copy the YC OS repo.
7. Restore `$YC_OS_SECRETS_DIR`.
8. Run:

```bash
npm install
npm run build
npm start -- --hostname 0.0.0.0
```

9. Install the browser QA runner:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

10. Re-run the smoke suite from this document.

This path is clean, but it is operational work. Use it if this VPS is meant to become the long-lived development box. For current QA, the platform override is less disruptive.

## How I Would Handle It

For this project, use a two-lane QA setup:

1. Keep the current VPS flow for fast backend/data checks and browser smoke checks:
   - typecheck
   - tests
   - build
   - HTTP smoke checks
   - gstack browse with `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`
   - Supabase/import verification
2. Later, add browser QA in a supported Playwright Docker image or CI runner:
   - desktop screenshot
   - mobile screenshot
   - search interaction
   - paging interaction
   - intro expansion
   - add-note behavior

Do not rebuild or downgrade the VPS just for this. The override gives us a working local browser runner now.

## Minimum Browser Smoke Suite

When a supported browser runner is available, test:

1. Load `/` and assert the title includes `YC Winter 2026 Event Prep`.
2. Assert the directory shows `Showing 1-25 of 415 founders`.
3. Search for a known founder and verify the list narrows.
4. Click `Next` and verify the range changes to `Showing 26-50`.
5. Select a founder and verify the detail panel updates.
6. Open `More context` under Intro.
7. Add a note and verify it appears in the Notes section.
8. Capture desktop and mobile screenshots.

## Decision

Short term: use `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` with gstack browse on this VPS.

Long term: use Docker/CI Playwright for reproducible visual QA. Keep the current local HTTP checks as the default non-browser smoke test.

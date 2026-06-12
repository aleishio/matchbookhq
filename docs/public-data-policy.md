# Public Data Policy

Only public data belongs in this project.

Allowed:

- Public YC company profile data.
- Public founder/company websites.
- Public job posts.
- Public documentation.
- Public source URLs and retrieval timestamps.

Not allowed:

- Private YC company data.
- Private notes from founders or users.
- Analytics payloads containing founder/applicant names, emails, phones, raw
  notes, asks, intro openers, evidence text, registration answers, or provider
  raw payloads.
- Credentials or access tokens.
- Raw logs with request bodies, cookies, auth headers, or API keys.
- Non-public scraped data behind authentication.

For each import, store:

- Source URL.
- Retrieval timestamp.
- Import script/version.
- Any relevant terms or license notes.

For PostHog:

- Track workflow events with counts, buckets, stages, categories, queue names,
  and booleans.
- Keep recordings behind `ph-no-capture` masking and disable them immediately if
  review shows private content leaking.
- Treat PostHog project tokens as browser-public configuration, not secrets.

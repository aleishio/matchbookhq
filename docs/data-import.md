# Data Import

This V1 seed is deterministic local JSON generated from a public YC Winter 2026
extract stored outside the repo. Use a local `yc_extract/output` directory or
set `YC_EXTRACT_OUTPUT_DIR`.

Run:

```sh
node scripts/import-yc-data.mjs /path/to/yc_extract/output
```

Optional source override:

```sh
YC_EXTRACT_OUTPUT_DIR=/path/to/yc_extract/output node scripts/import-yc-data.mjs
```

Generated app data:

- `data/events.json`
- `data/companies.json`
- `data/founders.json`
- `data/attendance.json`
- `data/founder-needs.json`
- `data/notes.json`
- `data/assets.json`
- `data/seed.json`
- `data/import-manifest.json`

Copied public images live under `public/founders/winter-2026/**`. Founder records expose local image paths at `image_paths.photo`; companies expose local logo paths at `image_paths.logo` and `image_paths.small_logo`.

Privacy note: all records are derived from public YC company profiles, public launch pages, public job posts, and public enrichment files. The generated notes are public-derived seed context for the demo, not private office-hours or founder notes.

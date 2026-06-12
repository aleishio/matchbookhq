# Notes Model

The V1 notes layer is pure TypeScript and lives in `lib/notes`. It has no app, database, or React dependency.

## Types

`Note.type` supports four buckets:

- `office_hours`
- `other_founder`
- `room`
- `user`

Seeded demo/import notes should use the first three buckets. Notes created through the add-note UI should usually use `user`, unless the UI deliberately offers a type selector.

```ts
import {
  getFounderNotesView,
  normalizeNotes,
} from "@/lib/notes";
import notesJson from "@/data/notes.json";

const notes = normalizeNotes(notesJson);
const view = getFounderNotesView(notes, {
  id: selectedFounder.id,
  name: selectedFounder.name,
  companyName: selectedFounder.companyName,
  category: selectedFounder.category,
  needText: selectedFounder.needText,
  location: selectedFounder.location,
});
```

`normalizeNotes` accepts both the imported snake_case shape (`founder_id`, `note_type`, `created_at`, string `source`) and the camelCase helper shape. `getFounderNotesView` returns grouped notes in display order and creates synthetic fallback notes when a founder has no notes. That keeps the V1 demo path populated while data import work is still settling.

## Demo Data

`data/notes.json` is the preferred imported note seed when present. `data/demo-notes.json` is a smaller synthetic public-safe fallback. Neither file should contain private office-hours history; replace or augment them only with public-safe summaries.

If imported founder IDs differ from `founder_001`, `founder_002`, and `founder_003`, either map the seed notes during import or rely on `getFounderNotesView` to create temporary synthetic fallback notes for the selected demo founder.

Current app integration note: `app/lib/event-prep-data.ts` reads normalized notes from the compact seed data and uses `getFounderNotesView` for per-founder grouping and synthetic fallback notes.

const NOTE_TYPES = [
  "office_hours",
  "other_founder",
  "room",
  "user",
] as const;

type NoteType = (typeof NOTE_TYPES)[number];

const NOTE_TYPE_ORDER: NoteType[] = [
  "office_hours",
  "other_founder",
  "room",
  "user",
];

type NoteSourceKind =
  | "office_hours"
  | "founder"
  | "room"
  | "user"
  | "demo";

interface NoteSource {
  kind: NoteSourceKind;
  label?: string;
  founderId?: string;
  founderName?: string;
  eventId?: string;
  sourceUrl?: string;
  retrievedAt?: string;
}

export interface Note {
  id: string;
  founderId: string;
  type: NoteType;
  body: string;
  source: NoteSource;
  createdAt: string;
  updatedAt?: string;
  authorName?: string;
  isSynthetic?: boolean;
}

interface CreateNoteInput {
  founderId: string;
  body: string;
  type?: NoteType;
  source?: NoteSource;
  createdAt?: string;
  updatedAt?: string;
  authorName?: string;
  id?: string;
  isSynthetic?: boolean;
}

interface FounderNoteSubject {
  id: string;
  name?: string;
  companyName?: string;
  category?: string;
  needText?: string;
  location?: string;
}

type NotesByType = Record<NoteType, Note[]>;

interface FounderNotesView {
  founderId: string;
  notes: Note[];
  groups: NotesByType;
  totalCount: number;
  hasNotes: boolean;
  hasSyntheticFallback: boolean;
}

interface FallbackNoteOptions {
  eventId?: string;
  createdAt?: string;
}

function isNoteType(value: unknown): value is NoteType {
  return typeof value === "string" && NOTE_TYPES.includes(value as NoteType);
}

function createNote(input: CreateNoteInput): Note {
  const body = normalizeBody(input.body);
  const type = input.type ?? "user";
  const createdAt = input.createdAt ?? new Date().toISOString();
  const source = input.source ?? { kind: type === "user" ? "user" : "demo" };

  return {
    id:
      input.id ??
      createStableNoteId({
        founderId: input.founderId,
        type,
        body,
        createdAt,
        source,
      }),
    founderId: input.founderId,
    type,
    body,
    source,
    createdAt,
    updatedAt: input.updatedAt,
    authorName: input.authorName,
    isSynthetic: input.isSynthetic,
  };
}

export function normalizeNotes(
  rawNotes: readonly unknown[] | { notes?: unknown },
): Note[] {
  const records = Array.isArray(rawNotes)
    ? rawNotes
    : isRecord(rawNotes) && Array.isArray(rawNotes.notes)
      ? rawNotes.notes
      : [];

  return records
    .map(coerceNote)
    .filter((note): note is Note => note !== null)
    .sort(compareNotes);
}

function getNotesForFounder(
  notes: readonly Note[],
  founderId: string,
): Note[] {
  return notes
    .filter((note) => note.founderId === founderId)
    .slice()
    .sort(compareNotes);
}

function groupNotesByType(notes: readonly Note[]): NotesByType {
  const groups = createEmptyGroups();

  for (const note of notes) {
    groups[note.type].push(note);
  }

  for (const type of NOTE_TYPE_ORDER) {
    groups[type].sort(compareNotes);
  }

  return groups;
}

export function getFounderNotesView(
  notes: readonly Note[],
  founder: FounderNoteSubject | string,
  options: FallbackNoteOptions = {},
): FounderNotesView {
  const subject = typeof founder === "string" ? { id: founder } : founder;
  const directNotes = getNotesForFounder(notes, subject.id);
  const viewNotes =
    directNotes.length > 0
      ? directNotes
      : buildFallbackNotesForFounder(subject, options);

  return {
    founderId: subject.id,
    notes: viewNotes,
    groups: groupNotesByType(viewNotes),
    totalCount: viewNotes.length,
    hasNotes: viewNotes.length > 0,
    hasSyntheticFallback: directNotes.length === 0 && viewNotes.length > 0,
  };
}

function buildFallbackNotesForFounder(
  founder: FounderNoteSubject,
  options: FallbackNoteOptions = {},
): Note[] {
  const createdAt = options.createdAt ?? "2026-06-09T05:32:00.000Z";
  const name = founder.name ?? "this founder";
  const company = founder.companyName ?? "their company";
  const category = founder.category ?? "their category";
  const need = founder.needText ?? "the current event ask";
  const location = founder.location ?? "the room";
  const sourceBase: NoteSource = {
    kind: "demo",
    eventId: options.eventId,
    label: "Synthetic demo note",
  };

  return [
    createNote({
      founderId: founder.id,
      type: "office_hours",
      body: `${name} is focused on ${need}. In office-hours prep, keep the first question concrete and tie it back to the next useful founder intro.`,
      source: sourceBase,
      createdAt,
      isSynthetic: true,
    }),
    createNote({
      founderId: founder.id,
      type: "other_founder",
      body: `Other founders should compare notes with ${company} on ${category} only when there is an actionable customer, hiring, or fundraising overlap.`,
      source: sourceBase,
      createdAt,
      isSynthetic: true,
    }),
    createNote({
      founderId: founder.id,
      type: "room",
      body: `Room context: ${location} is a good place to ask for the narrowest blocker before suggesting an intro.`,
      source: sourceBase,
      createdAt,
      isSynthetic: true,
    }),
  ];
}

function compareNotes(left: Note, right: Note): number {
  const timeDelta =
    getTimestamp(right.createdAt) - getTimestamp(left.createdAt);

  if (timeDelta !== 0) {
    return timeDelta;
  }

  const typeDelta =
    NOTE_TYPE_ORDER.indexOf(left.type) - NOTE_TYPE_ORDER.indexOf(right.type);

  if (typeDelta !== 0) {
    return typeDelta;
  }

  return left.id.localeCompare(right.id);
}

function coerceNote(raw: unknown): Note | null {
  if (!isRecord(raw)) {
    return null;
  }

  const founderId = readStringAny(raw, ["founderId", "founder_id"]);
  const body = normalizeBody(readString(raw, "body") ?? "");
  const type = coerceNoteType(readStringAny(raw, ["type", "note_type"]));

  if (!founderId || body.length === 0 || !type) {
    return null;
  }

  const source = coerceSource(raw.source, type, raw);
  const createdAt =
    readStringAny(raw, ["createdAt", "created_at"]) ?? new Date().toISOString();

  return createNote({
    id: readString(raw, "id") ?? undefined,
    founderId,
    type,
    body,
    source,
    createdAt,
    updatedAt: readStringAny(raw, ["updatedAt", "updated_at"]) ?? undefined,
    authorName: readString(raw, "authorName") ?? undefined,
    isSynthetic: readBoolean(raw, "isSynthetic") ?? undefined,
  });
}

function coerceSource(
  raw: unknown,
  type: NoteType,
  noteRecord?: Record<string, unknown>,
): NoteSource {
  if (typeof raw === "string") {
    return {
      kind: type === "user" ? "user" : "demo",
      label: raw,
      sourceUrl: noteRecord
        ? readStringAny(noteRecord, ["sourceUrl", "source_url"]) ?? undefined
        : undefined,
      retrievedAt: noteRecord
        ? readStringAny(noteRecord, ["retrievedAt", "retrieved_at"]) ?? undefined
        : undefined,
    };
  }

  if (!isRecord(raw)) {
    return { kind: type === "user" ? "user" : "demo" };
  }

  const kind = readString(raw, "kind");

  return {
    kind: isSourceKind(kind) ? kind : type === "user" ? "user" : "demo",
    label: readString(raw, "label") ?? undefined,
    founderId: readString(raw, "founderId") ?? undefined,
    founderName: readString(raw, "founderName") ?? undefined,
    eventId: readString(raw, "eventId") ?? undefined,
    sourceUrl: readStringAny(raw, ["sourceUrl", "source_url"]) ?? undefined,
    retrievedAt: readStringAny(raw, ["retrievedAt", "retrieved_at"]) ?? undefined,
  };
}

function coerceNoteType(value: string | null): NoteType | null {
  if (isNoteType(value)) {
    return value;
  }

  switch (value) {
    case "Office hours":
    case "office-hours":
      return "office_hours";
    case "Founder note":
    case "founder_note":
    case "other-founder":
      return "other_founder";
    case "Room note":
    case "room-note":
      return "room";
    case "Local note":
    case "local_note":
    case "added_note":
      return "user";
    default:
      return null;
  }
}

function createEmptyGroups(): NotesByType {
  return {
    office_hours: [],
    other_founder: [],
    room: [],
    user: [],
  };
}

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

function createStableNoteId(input: {
  founderId: string;
  type: NoteType;
  body: string;
  createdAt: string;
  source: NoteSource;
}): string {
  const sourceLabel = input.source.label ?? input.source.kind;
  const hash = hashString(
    [input.founderId, input.type, input.createdAt, sourceLabel, input.body].join(
      "|",
    ),
  );

  return `note_${slugify(input.founderId)}_${input.type}_${hash}`;
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "founder";
}

function getTimestamp(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];

  return typeof value === "string" ? value : null;
}

function readStringAny(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = readString(record, key);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];

  return typeof value === "boolean" ? value : null;
}

function isSourceKind(value: unknown): value is NoteSourceKind {
  return (
    value === "office_hours" ||
    value === "founder" ||
    value === "room" ||
    value === "user" ||
    value === "demo"
  );
}

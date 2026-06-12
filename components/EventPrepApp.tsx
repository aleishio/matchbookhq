"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EventPrepFounder, EventPrepNote } from "@/app/lib/event-prep-data";
import type {
  EventPrepEventSummary,
  EventPrepLens,
  EventPrepListResponse
} from "@/app/lib/event-prep-repository";
import {
  captureAnalyticsEvent,
  textLengthBucket
} from "@/lib/analytics";
import { SiteHeader } from "@/components/SiteHeader";

const PAGE_SIZE = 25;
const AVATAR_DIMENSIONS = {
  small: 36,
  medium: 72,
  large: 104
} as const;

const LENSES: Array<{ id: EventPrepLens; label: string }> = [
  { id: "all", label: "All" },
  { id: "intro", label: "Suggested intros" },
  { id: "caution", label: "Caution" },
  { id: "ai", label: "AI infra" }
];

type FounderCache = Record<string, EventPrepFounder>;

export function EventPrepApp({
  data,
  events
}: {
  data: EventPrepListResponse;
  events: EventPrepEventSummary[];
}) {
  const [selectedEventId, setSelectedEventId] = useState(data.event.id);
  const [lens, setLens] = useState<EventPrepLens>(data.query.lens);
  const [query, setQuery] = useState(data.query.search);
  const [page, setPage] = useState(data.page);
  const [response, setResponse] = useState<EventPrepListResponse>(data);
  const [founderCache, setFounderCache] = useState<FounderCache>(() => founderCacheFromResponse(data));
  const [selectedId, setSelectedId] = useState(data.founders[0]?.id ?? "");
  const [draftNote, setDraftNote] = useState("");
  const [localNotes, setLocalNotes] = useState<Record<string, EventPrepNote[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const viewedRef = useRef(false);
  const skippedInitialRequestRef = useRef(false);
  const latestRequestRef = useRef(0);
  const initialRequestKeyRef = useRef(requestKeyFor(data.event.id, data.query.lens, data.query.search, data.page));

  const foundersById = useMemo(() => {
    return new Map(Object.entries(founderCache));
  }, [founderCache]);

  const totalPages = Math.max(1, Math.ceil(response.total / PAGE_SIZE));
  const boundedPage = Math.min(page, totalPages);
  const visibleFounders = response.founders;
  const selectedFounder = foundersById.get(selectedId) ?? visibleFounders[0];
  const selectedEventFromList = events.find((event) => event.id === selectedEventId);
  const selectedEvent = response.event.id === selectedEventId
    ? response.event
    : selectedEventFromList ?? response.event;
  const activeEventId = selectedEvent?.id ?? response.event.id;

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;

    captureAnalyticsEvent("event prep viewed", {
      attendee_count: data.event.attendeeCount,
      event_id: data.event.id,
      founder_count: data.event.attendeeCount,
      page_size: PAGE_SIZE,
      source: data.event.source
    });
  }, [data.event.attendeeCount, data.event.id, data.event.source]);

  useEffect(() => {
    if (page === boundedPage) return;
    setPage(boundedPage);
  }, [boundedPage, page]);

  useEffect(() => {
    const requestKey = requestKeyFor(activeEventId, lens, query, page);
    if (!skippedInitialRequestRef.current && requestKey === initialRequestKeyRef.current) {
      skippedInitialRequestRef.current = true;
      return;
    }

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    const controller = new AbortController();
    const params = new URLSearchParams({
      eventId: activeEventId,
      lens,
      search: query,
      page: String(page),
      pageSize: String(PAGE_SIZE)
    });

    setIsLoading(true);
    setLoadError(null);

    fetch(`/api/event-prep?${params.toString()}`, { signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) throw new Error(`Event prep request failed with ${result.status}.`);
        return result.json() as Promise<EventPrepListResponse>;
      })
      .then((nextResponse) => {
        if (latestRequestRef.current !== requestId) return;
        setResponse(nextResponse);
        setFounderCache((current) => mergeFounderCache(current, nextResponse));
        setSelectedEventId(nextResponse.event.id);
        setSelectedId((current) => {
          if (current && nextResponse.founders.some((founder) => founder.id === current)) return current;
          return nextResponse.founders[0]?.id ?? "";
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || latestRequestRef.current !== requestId) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load founders.");
      })
      .finally(() => {
        if (latestRequestRef.current === requestId) setIsLoading(false);
      });

    return () => controller.abort();
  }, [activeEventId, lens, page, query]);

  function clearFilters() {
    captureAnalyticsEvent("founder filters cleared", {
      event_id: activeEventId,
      previous_lens: lens,
      query_length_bucket: textLengthBucket(query)
    });
    setLens("all");
    setQuery("");
    setPage(1);
  }

  function changeEvent(nextEventId: string) {
    const nextEvent = events.find((event) => event.id === nextEventId);
    captureAnalyticsEvent("founder event changed", {
      event_id: nextEventId,
      founder_count: nextEvent?.attendeeCount ?? 0,
      previous_event_id: activeEventId
    });
    setSelectedEventId(nextEventId);
    setPage(1);
    setSelectedId("");
  }

  function changeLens(nextLens: EventPrepLens) {
    captureAnalyticsEvent("founder filter changed", {
      event_id: activeEventId,
      lens: nextLens,
      result_count: response.total
    });
    setLens(nextLens);
    setPage(1);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setPage(1);
  }

  function captureSearchSubmitted() {
    captureAnalyticsEvent("founder search submitted", {
      event_id: activeEventId,
      query_length_bucket: textLengthBucket(query),
      result_count: response.total
    });
  }

  function goToPage(nextPage: number) {
    const safePage = Math.max(1, Math.min(totalPages, nextPage));
    captureAnalyticsEvent("founder page changed", {
      event_id: activeEventId,
      page: safePage,
      page_size: PAGE_SIZE,
      result_count: response.total,
      total_pages: totalPages
    });
    setPage(safePage);
  }

  function selectFounder(founder: EventPrepFounder) {
    captureAnalyticsEvent("founder selected", founderAnalyticsProperties(activeEventId, founder));
    captureIntroViewed(founder);
    setSelectedId(founder.id);
  }

  function addNote() {
    if (!selectedFounder || !draftNote.trim()) return;

    const note: EventPrepNote = {
      id: `${selectedFounder.id}-local-${Date.now()}`,
      type: "Local note",
      body: draftNote.trim()
    };

    setLocalNotes((current) => ({
      ...current,
      [selectedFounder.id]: [...(current[selectedFounder.id] ?? []), note]
    }));
    captureAnalyticsEvent("note added", {
      event_id: activeEventId,
      founder_batch: selectedFounder.company.batch,
      founder_category: selectedFounder.company.category,
      note_length_bucket: textLengthBucket(draftNote),
      note_type: "local",
      visible_note_count: selectedFounder.notes.length + (localNotes[selectedFounder.id]?.length ?? 0) + 1
    });
    setDraftNote("");
  }

  function captureIntroContext(founder: EventPrepFounder, target?: EventPrepFounder) {
    if (!founder.intro || !target) return;

    captureAnalyticsEvent("intro context expanded", {
      event_id: activeEventId,
      fit_label: founder.intro.fitLabel,
      founder_category: founder.company.category,
      has_caution: Boolean(founder.intro.caution),
      same_company: Boolean(founder.intro.sameCompany),
      target_category: target.company.category
    });
  }

  function captureIntroViewed(founder: EventPrepFounder) {
    if (!founder.intro) return;

    const target = foundersById.get(founder.intro.targetFounderId);
    if (!target) return;

    captureAnalyticsEvent("intro viewed", {
      event_id: activeEventId,
      fit_label: founder.intro.fitLabel,
      founder_category: founder.company.category,
      has_caution: Boolean(founder.intro.caution),
      same_company: Boolean(founder.intro.sameCompany),
      target_category: target.company.category
    });
  }

  const firstVisible = response.total === 0 ? 0 : (response.page - 1) * PAGE_SIZE + 1;
  const lastVisible = response.total === 0 ? 0 : firstVisible + visibleFounders.length - 1;
  const selectedTarget = selectedFounder?.intro ? foundersById.get(selectedFounder.intro.targetFounderId) : undefined;

  return (
    <main className="app-shell">
      <SiteHeader active="prep" />

      <section className="workspace" aria-label="Event prep workspace">
        <section className="main-pane">
          <div className="toolbar prep-toolbar">
            <div className="prep-toolbar-top">
              <div className="toolbar-title-block">
                <div className="queue-title">Event prep</div>
                <div className="toolbar-subtitle">
                  {selectedEvent.title} | {selectedEvent.attendeeCount} founders | {selectedEvent.startsAt}
                </div>
              </div>
              <label className="event-select-wrap prep-event-select">
                <span className="sr-only">Select prep event</span>
                <select
                  className="event-select"
                  value={selectedEventId}
                  onChange={(event) => changeEvent(event.target.value)}
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {eventOptionLabel(event)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="prep-event-actions">
                {selectedEvent.sourceUrl ? (
                  <a className="event-source-link" href={selectedEvent.sourceUrl} rel="noreferrer" target="_blank">
                    Open Lu.ma
                  </a>
                ) : null}
              </div>
            </div>

            <div className="prep-toolbar-controls">
              <div className="lens-group" aria-label="Event prep lenses">
                {LENSES.map((item) => (
                  <button
                    className={`chip${lens === item.id ? " active" : ""}`}
                    key={item.id}
                    onClick={() => changeLens(item.id)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="search-wrap prep-search">
                <span className="sr-only">Search founders</span>
                <input
                  value={query}
                  onBlur={captureSearchSubmitted}
                  onChange={(event) => changeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") captureSearchSubmitted();
                  }}
                  placeholder="Search founders..."
                />
              </label>
              <div className="pager-actions prep-pager" aria-label="Directory pagination">
                <span className="queue-count">
                  {isLoading
                    ? "Loading..."
                    : response.total > 0
                      ? `Showing ${firstVisible}-${lastVisible} of ${response.total} founders`
                      : "No founders"}
                </span>
                <button className="note-btn" disabled={boundedPage === 1 || isLoading} onClick={() => goToPage(boundedPage - 1)} type="button">
                  Previous
                </button>
                <button className="note-btn" disabled={boundedPage === totalPages || isLoading} onClick={() => goToPage(boundedPage + 1)} type="button">
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="content-grid">
            <aside className="directory-shell" aria-label="Founder list">
              <div className="directory">
                {visibleFounders.length > 0 ? (
                  visibleFounders.map((founder) => (
                    <FounderRow
                      active={selectedFounder?.id === founder.id}
                      founder={founder}
                      key={founder.id}
                      onSelect={() => selectFounder(founder)}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>{loadError ? "Could not load founders" : "No matching founders"}</strong>
                    <span>{loadError ?? "Try a broader search or reset the current lens."}</span>
                    <button className="note-btn" onClick={clearFilters} type="button">
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </aside>

            {selectedFounder ? (
              <FounderDetail
                draftNote={draftNote}
                founder={selectedFounder}
                localNotes={localNotes[selectedFounder.id] ?? []}
                onAddNote={addNote}
                onDraftNoteChange={setDraftNote}
                onIntroContextOpen={() => captureIntroContext(selectedFounder, selectedTarget)}
                target={selectedTarget}
              />
            ) : (
              <article className="profile empty-profile">
                <div className="label">Selection</div>
                <p>No founder selected.</p>
              </article>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function FounderRow({
  active,
  founder,
  onSelect
}: {
  active: boolean;
  founder: EventPrepFounder;
  onSelect: () => void;
}) {
  const signalText = [
    founder.introCount > 0 ? `${founder.introCount} intro${founder.introCount === 1 ? "" : "s"}` : "",
    founder.cautionCount > 0 ? `${founder.cautionCount} caution${founder.cautionCount === 1 ? "" : "s"}` : ""
  ].filter(Boolean).join(" / ") || "notes";

  return (
    <button className={`founder-row${active ? " active" : ""}`} onClick={onSelect} type="button">
      <Avatar founder={founder} size="small" />
      <span className="row-copy ph-no-capture">
        <span className="name">{founder.name}</span>
        <span className="company-line">
          {founder.company.name} | {founder.company.stage}
        </span>
        <span className="ask-line">{founder.need}</span>
        <span className="row-foot">
          <span className={`row-pill${isAiFounder(founder) ? " ai" : ""}`}>{founder.company.category}</span>
          <span className={`row-pill${founder.cautionCount > 0 ? " warn" : " ai"}`}>{signalText}</span>
        </span>
      </span>
    </button>
  );
}

function FounderDetail({
  draftNote,
  founder,
  localNotes,
  onAddNote,
  onDraftNoteChange,
  onIntroContextOpen,
  target
}: {
  draftNote: string;
  founder: EventPrepFounder;
  localNotes: EventPrepNote[];
  onAddNote: () => void;
  onDraftNoteChange: (value: string) => void;
  onIntroContextOpen: () => void;
  target?: EventPrepFounder;
}) {
  const notes = [...founder.notes, ...localNotes];

  return (
    <article className="profile">
      <div className="profile-top">
        <Avatar founder={founder} size="large" />
        <div className="profile-heading ph-no-capture">
          <h1>{founder.name}</h1>
          <div className="profile-sub">
            {founder.company.name} | {founder.company.stage} | {founder.company.category} | {founder.location}
          </div>
        </div>
      </div>

      <section className="section">
        <div className="label">Ask</div>
        <div className="ask-text ph-no-capture">{founder.ask}</div>
      </section>

      <section className="section">
        <div className="label">Intro</div>
        {founder.intro && target ? (
          <div className="match ph-no-capture">
            <div className="intro-people">
              <Avatar founder={founder} size="medium" />
              <span>{firstName(founder.name)}</span>
              <span className="intro-arrow">-&gt;</span>
              <Avatar founder={target} size="medium" />
              <span>{firstName(target.name)}</span>
            </div>
            <div className="match-top">
              <strong>
                {founder.intro.sameCompany ? "Prep context with" : "Connect with"} {target.name}, {target.company.name}.
              </strong>
              <div className="confidence">{founder.intro.fitLabel}</div>
            </div>
            <div className="intro-route">
              <div>
                <span>Recommended by</span>
                <strong>{founder.intro.route?.recommendedBy ?? "YC OS Assistant"}</strong>
              </div>
              <div>
                <span>Route</span>
                <strong>{founder.intro.route?.channel ?? "In-room intro"}</strong>
              </div>
            </div>
            <div className="match-summary">{founder.intro.reason}</div>
            {founder.intro.route?.instruction ? (
              <div className="intro-instruction">{founder.intro.route.instruction}</div>
            ) : null}
            {founder.intro.route?.contacts?.length ? (
              <div className="intro-contacts" aria-label={`Contact routes for ${target.name}`}>
                {founder.intro.route.contacts.map((contact) => (
                  <a href={contact.url} key={`${contact.kind}-${contact.url}`} rel="noreferrer" target="_blank">
                    <span>{contact.label}</span>
                    <strong>{contact.value}</strong>
                  </a>
                ))}
              </div>
            ) : null}
            <em className="opener">Opener: &quot;{founder.intro.opener}&quot;</em>
            <details
              className="intro-more"
              onToggle={(event) => {
                if (event.currentTarget.open) onIntroContextOpen();
              }}
            >
              <summary>More context</summary>
              <div>
                {founder.intro.caution ?? "Make the intro in person, then watch whether both founders lean in before deepening it."}
              </div>
              <div className="evidence">
                {founder.intro.evidence.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </details>
          </div>
        ) : (
          <div className="empty-inline">No suggested intro yet. Use notes to capture room context.</div>
        )}
      </section>

      <section className="section">
        <div className="label">Notes</div>
        <div className="notes-list">
          {notes.length > 0 ? (
            notes.map((note) => (
              <div className="note-row ph-no-capture" key={note.id}>
                <span className="note-source">{note.type}</span>
                <div className="note-text">{note.body}</div>
              </div>
            ))
          ) : (
            <div className="empty-inline">No notes yet.</div>
          )}
        </div>
        <div className="add-note">
          <input
            value={draftNote}
            onChange={(event) => onDraftNoteChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAddNote();
            }}
            placeholder="Add note from office hours or the room..."
          />
          <button className="note-btn" disabled={!draftNote.trim()} onClick={onAddNote} type="button">
            Add note
          </button>
        </div>
      </section>
    </article>
  );
}

function founderAnalyticsProperties(eventId: string, founder: EventPrepFounder) {
  return {
    caution_count: founder.cautionCount,
    event_id: eventId,
    founder_batch: founder.company.batch,
    founder_category: founder.company.category,
    founder_stage: founder.company.stage,
    has_caution: founder.cautionCount > 0,
    has_intro: founder.introCount > 0,
    intro_count: founder.introCount
  };
}

function Avatar({ founder, size }: { founder: EventPrepFounder; size: "small" | "medium" | "large" }) {
  const [failed, setFailed] = useState(false);
  const className = `avatar avatar-${size}`;

  useEffect(() => {
    setFailed(false);
  }, [founder.photoUrl]);

  if (!founder.photoUrl || failed) {
    return <span className={`${className} avatar-fallback`}>{initialsFor(founder.name)}</span>;
  }

  return (
    <img
      alt={founder.name}
      className={className}
      decoding="async"
      height={AVATAR_DIMENSIONS[size]}
      loading={size === "large" ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      src={founder.photoUrl}
      width={AVATAR_DIMENSIONS[size]}
    />
  );
}

function founderCacheFromResponse(response: EventPrepListResponse): FounderCache {
  return Object.fromEntries(
    [...response.founders, ...response.relatedFounders].map((founder) => [founder.id, founder])
  );
}

function mergeFounderCache(current: FounderCache, response: EventPrepListResponse): FounderCache {
  return {
    ...current,
    ...founderCacheFromResponse(response)
  };
}

function requestKeyFor(eventId: string, lens: EventPrepLens, query: string, page: number) {
  return `${eventId}:${lens}:${query}:${page}`;
}

function eventOptionLabel(event: EventPrepEventSummary) {
  return `${event.title} (${event.attendeeCount})`;
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

function isAiFounder(founder: EventPrepFounder) {
  const text = `${founder.company.category} ${founder.company.oneLiner}`.toLowerCase();
  return text.includes("ai") || text.includes("model") || text.includes("agent") || text.includes("infra");
}

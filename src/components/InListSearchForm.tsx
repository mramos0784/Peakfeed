"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResolutionProvenance } from "@/lib/parseLink";

type ListInfo = { slug: string; name: string; type: string };

type SearchCandidate = {
  category: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  provenance: ResolutionProvenance;
  sourceLabel: string;
};

// Only the two provenance values a search-sourced candidate can ever carry
// (the direct-create categories below never go through this map at all).
const PROVENANCE_LABEL: Partial<Record<ResolutionProvenance, string>> = {
  wikidata_match: "Wikidata",
  web_search: "Web search",
};

// Categories with no live catalog to search against - typed input goes
// straight through the internal dedup key (src/lib/normalize.ts) and
// creates/matches the entry directly, no candidates to choose from.
const DIRECT_CREATE_TYPES = ["song", "restaurant", "venue"];

const CREATOR_TYPES = ["x_creator", "instagram_creator", "tiktok_creator", "youtube_creator"];

// Closed dropdown per docs/api-integrations-addendum.md section 8, plus the
// required "Other" escape hatch.
const SECTION_TAGS = [
  "Politics", "World", "Local", "Business", "Science", "Health",
  "Environment", "Education", "Crime & Safety", "Sports", "Weather", "Culture",
];

type Step = "form" | "searching" | "results" | "confirm" | "saving" | "done" | "error";

const inputClass = "w-full border rounded-md px-2 py-1.5 text-sm";

// Structured, named-field search scoped to the list already open - distinct
// from AddToListsButton's global "+" flow, which is one free-text box that
// can target any category. The category here is fixed (the list's own
// type), so the fields can be precise instead of generic, per
// docs/api-integrations-addendum.md section 9.
export default function InListSearchForm({ list, homeCity }: { list: ListInfo; homeCity: string }) {
  const router = useRouter();
  const type = list.type;
  const isDirect = DIRECT_CREATE_TYPES.includes(type);
  const isCreator = CREATOR_TYPES.includes(type);
  const isEvent = type === "event";
  const isIssue = type === "issue";

  const [step, setStep] = useState<Step>("form");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Direct-create fields (Songs / Restaurants / Venues)
  const [directTitle, setDirectTitle] = useState("");
  const [directSubtitle, setDirectSubtitle] = useState(type === "restaurant" || type === "venue" ? homeCity : "");

  // Search-query fields, per category
  const [movieTitle, setMovieTitle] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [handle, setHandle] = useState("");
  const [sectionTag, setSectionTag] = useState("");
  const [sectionOtherText, setSectionOtherText] = useState("");
  const [issueName, setIssueName] = useState("");

  // null = hasn't responded yet, [] = responded with nothing - matches
  // AddToListsButton's pattern so each source's section renders the moment
  // it resolves, independent of the other.
  const [wikidataResults, setWikidataResults] = useState<SearchCandidate[] | null>(null);
  const [webResults, setWebResults] = useState<SearchCandidate[] | null>(null);

  // Confirm-step fields, shared shape regardless of which source the
  // candidate came from.
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmSubtitle, setConfirmSubtitle] = useState("");
  const [confirmExternalId, setConfirmExternalId] = useState<string | null>(null);
  const [confirmProvenance, setConfirmProvenance] = useState<ResolutionProvenance | null>(null);

  function resetAfterSave() {
    setDirectTitle("");
    setDirectSubtitle(type === "restaurant" || type === "venue" ? homeCity : "");
    setMovieTitle("");
    setEventName("");
    setEventLocation("");
    setEventDate("");
    setHandle("");
    setSectionTag("");
    setSectionOtherText("");
    setIssueName("");
    setWikidataResults(null);
    setWebResults(null);
    setStep("form");
  }

  function searchQuery(): string {
    if (type === "movie") return movieTitle.trim();
    if (isEvent) return eventName.trim();
    if (isCreator) return handle.trim();
    if (isIssue) return issueName.trim();
    return "";
  }

  async function handleDirectSave(e: React.FormEvent) {
    e.preventDefault();
    const title = directTitle.trim();
    const subtitle = directSubtitle.trim();
    if (!title || !subtitle) return;
    setStep("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listSlug: list.slug,
          type,
          title,
          subtitle,
          image_url: null,
          source_url: null,
          external_id: null,
          provenance: "manual",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Could not save that entry.");
        setStep("error");
        return;
      }
      setStep("done");
      router.refresh();
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStep("error");
    }
  }

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = searchQuery();
    if (!query) return;
    if (isIssue && !sectionTag) return;
    if (isIssue && sectionTag === "Other" && !sectionOtherText.trim()) return;

    setStep("searching");
    setErrorMsg(null);
    setWikidataResults(null);
    setWebResults(null);
    setStep("results");

    fetch("/api/search/wikidata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, category: type }),
    })
      .then((res) => res.json())
      .then((data) => setWikidataResults(data.candidates ?? []))
      .catch(() => setWikidataResults([]));

    fetch("/api/search/web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        category: type,
        location: isEvent ? eventLocation.trim() || undefined : undefined,
        date: isEvent ? eventDate.trim() || undefined : undefined,
      }),
    })
      .then((res) => res.json())
      .then((data) => setWebResults(data.candidates ?? []))
      .catch(() => setWebResults([]));
  }

  function selectCandidate(c: SearchCandidate) {
    setConfirmTitle(c.title);
    setConfirmSubtitle(c.subtitle ?? "");
    setConfirmExternalId(c.external_id);
    setConfirmProvenance(c.provenance);
    setStep("confirm");
  }

  async function handleConfirmSave() {
    const title = confirmTitle.trim();
    if (!title) return;
    setStep("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listSlug: list.slug,
          type,
          title,
          subtitle: confirmSubtitle.trim() || null,
          image_url: null,
          source_url: null,
          external_id: confirmExternalId,
          provenance: confirmProvenance ?? "manual",
          date: isEvent ? eventDate.trim() || null : undefined,
          sectionTag: isIssue ? sectionTag : undefined,
          sectionOtherText: isIssue && sectionTag === "Other" ? sectionOtherText.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Could not save that entry.");
        setStep("error");
        return;
      }
      setStep("done");
      router.refresh();
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStep("error");
    }
  }

  const resultsLoaded = wikidataResults !== null && webResults !== null;
  const noResults = resultsLoaded && wikidataResults!.length === 0 && webResults!.length === 0;

  return (
    <div className="mb-4 bg-white rounded-lg p-3 border border-black/5">
      <label className="text-[10px] uppercase tracking-wide opacity-50 block mb-1">
        Search {list.name}
      </label>

      {step === "form" && isDirect && (
        <form onSubmit={handleDirectSave} className="space-y-2">
          <input
            value={directTitle}
            onChange={(e) => setDirectTitle(e.target.value)}
            placeholder={type === "song" ? "Title" : "Name"}
            className={inputClass}
            autoFocus
          />
          <input
            value={directSubtitle}
            onChange={(e) => setDirectSubtitle(e.target.value)}
            placeholder={type === "song" ? "Artist" : "City"}
            className={inputClass}
          />
          <button
            disabled={!directTitle.trim() || !directSubtitle.trim()}
            className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40"
            style={{ background: "var(--slate)" }}
          >
            Add
          </button>
        </form>
      )}

      {step === "form" && type === "movie" && (
        <form onSubmit={handleSearchSubmit} className="space-y-2">
          <input
            value={movieTitle}
            onChange={(e) => setMovieTitle(e.target.value)}
            placeholder="Title"
            className={inputClass}
            autoFocus
          />
          <button disabled={!movieTitle.trim()} className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40" style={{ background: "var(--slate)" }}>
            Search
          </button>
        </form>
      )}

      {step === "form" && isEvent && (
        <form onSubmit={handleSearchSubmit} className="space-y-2">
          <input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Name"
            className={inputClass}
            autoFocus
          />
          <input
            value={eventLocation}
            onChange={(e) => setEventLocation(e.target.value)}
            placeholder="Location"
            className={inputClass}
          />
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className={inputClass}
          />
          <button disabled={!eventName.trim()} className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40" style={{ background: "var(--slate)" }}>
            Search
          </button>
        </form>
      )}

      {step === "form" && isCreator && (
        <form onSubmit={handleSearchSubmit} className="space-y-2">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Handle (e.g. @username)"
            className={inputClass}
            autoFocus
          />
          <button disabled={!handle.trim()} className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40" style={{ background: "var(--slate)" }}>
            Search
          </button>
        </form>
      )}

      {step === "form" && isIssue && (
        <form onSubmit={handleSearchSubmit} className="space-y-2">
          <select
            value={sectionTag}
            onChange={(e) => setSectionTag(e.target.value)}
            className={inputClass}
          >
            <option value="">Section tag&hellip;</option>
            {SECTION_TAGS.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
            <option value="Other">Other</option>
          </select>
          {sectionTag === "Other" && (
            <input
              value={sectionOtherText}
              onChange={(e) => setSectionOtherText(e.target.value)}
              placeholder="Describe the section"
              className={inputClass}
            />
          )}
          <input
            value={issueName}
            onChange={(e) => setIssueName(e.target.value)}
            placeholder="Issue name"
            className={inputClass}
          />
          <button
            disabled={!issueName.trim() || !sectionTag || (sectionTag === "Other" && !sectionOtherText.trim())}
            className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40"
            style={{ background: "var(--slate)" }}
          >
            Search
          </button>
        </form>
      )}

      {step === "results" && (
        <div>
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wide opacity-50 mb-1.5">Wikidata</p>
            {wikidataResults === null && <p className="text-xs opacity-40">Searching...</p>}
            {wikidataResults !== null && wikidataResults.length === 0 && (
              <p className="text-xs opacity-40">No matches.</p>
            )}
            <div className="space-y-1.5">
              {wikidataResults?.map((c, i) => (
                <CandidateRow key={`wd-${i}`} candidate={c} onSelect={() => selectCandidate(c)} />
              ))}
            </div>
          </div>

          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wide opacity-50 mb-1.5">Web search</p>
            {webResults === null && <p className="text-xs opacity-40">Searching...</p>}
            {webResults !== null && webResults.length === 0 && (
              <p className="text-xs opacity-40">No matches.</p>
            )}
            <div className="space-y-1.5">
              {webResults?.map((c, i) => (
                <CandidateRow key={`web-${i}`} candidate={c} onSelect={() => selectCandidate(c)} />
              ))}
            </div>
          </div>

          {noResults && (
            <p className="text-xs opacity-50 mb-3">Nothing found. Try different words.</p>
          )}

          <button onClick={() => setStep("form")} className="text-sm px-3 py-1.5 rounded-md border">
            Back
          </button>
        </div>
      )}

      {step === "confirm" && (
        <div>
          <p className="text-[10px] uppercase tracking-wide opacity-50 mb-2">
            {confirmProvenance ? PROVENANCE_LABEL[confirmProvenance] ?? "Match" : "Match"} · please verify
          </p>
          <input
            value={confirmTitle}
            onChange={(e) => setConfirmTitle(e.target.value)}
            className={`${inputClass} mb-2 font-medium`}
          />
          <input
            value={confirmSubtitle}
            onChange={(e) => setConfirmSubtitle(e.target.value)}
            placeholder={isCreator ? "Handle" : "Subtitle"}
            className={`${inputClass} mb-3 opacity-70`}
          />
          <div className="flex gap-2">
            <button
              onClick={handleConfirmSave}
              disabled={!confirmTitle.trim()}
              className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40"
              style={{ background: "var(--rust)" }}
            >
              Looks right, add it
            </button>
            <button onClick={() => setStep("results")} className="text-sm px-3 py-1.5 rounded-md border">
              Back
            </button>
          </div>
        </div>
      )}

      {step === "saving" && <p className="text-sm opacity-60">Saving...</p>}

      {step === "done" && (
        <div>
          <p className="text-sm mb-2">Added.</p>
          <button onClick={resetAfterSave} className="text-sm px-3 py-1.5 rounded-md border">
            Search again
          </button>
        </div>
      )}

      {step === "error" && (
        <div>
          <p className="text-red-600 text-sm mb-2">{errorMsg}</p>
          <button onClick={() => setStep("form")} className="text-sm px-3 py-1.5 rounded-md border">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ candidate, onSelect }: { candidate: SearchCandidate; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left bg-white border rounded-md px-3 py-2 hover:border-black/30 transition"
    >
      <p className="text-sm font-medium">{candidate.title}</p>
      {candidate.subtitle && <p className="text-xs opacity-60 truncate">{candidate.subtitle}</p>}
      <p className="text-[10px] uppercase tracking-wide opacity-40 mt-1">
        {PROVENANCE_LABEL[candidate.provenance] ?? candidate.sourceLabel}
      </p>
    </button>
  );
}

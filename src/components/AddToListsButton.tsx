"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemList } from "@/lib/systemLists";

type ListContext = { slug: string; name: string; type: string };

type ResolutionProvenance = "direct_api" | "url_id" | "wikidata_match" | "web_search" | "ai_guess" | "manual";

// The two independent search sources fire in parallel for these categories
// (docs/adr/0006) - Wikidata + web search simultaneously, no gate. Every
// other category still uses the single-link-resolve flow only; typed text
// there shows "coming soon" until real category APIs (Spotify Search,
// Google Places) get built.
const MULTI_SEARCH_CATEGORIES = [
  "movie", "event", "issue", "x_creator", "tiktok_creator", "instagram_creator", "youtube_creator",
];

type SearchCandidate = {
  category: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  provenance: ResolutionProvenance;
  sourceLabel: string;
};

// What the confirm step actually needs, regardless of whether it came from
// a single pasted link (parseLink) or a selected search candidate - one
// shape so the confirm UI doesn't need to know which path produced it.
type PendingEntry = {
  category: string;
  provenance: ResolutionProvenance | null;
  sourceLabel: string;
  message?: string; // unsupported-source explanation
  sourceCount?: number; // events' "N sources found" note
};

const PROVENANCE_LABEL: Record<ResolutionProvenance, string> = {
  direct_api: "Verified",
  url_id: "Verified",
  wikidata_match: "Wikidata",
  web_search: "Web search",
  ai_guess: "AI guess",
  manual: "Manual",
};

function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  // People often paste a bare domain without the protocol, e.g.
  // "open.spotify.com/track/...". Treat anything domain-shaped as a link.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(trimmed);
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Soft ranking bias: results matching the list the button was opened from
// sort first, never excluded. Stable sort so within-category order (e.g.
// arrival order, or Wikidata's own relevance ranking) is preserved.
function sortByContext<T extends { category: string }>(items: T[], contextType?: string): T[] {
  if (!contextType) return items;
  return [...items].sort((a, b) => Number(b.category === contextType) - Number(a.category === contextType));
}

type Step =
  | "input"
  | "typed-unsupported"
  | "parsing"
  | "results"
  | "confirm"
  | "saving"
  | "done"
  | "error";

// Persistent global entry point for adding something to a list, reachable
// from Map, the Lists index, and any individual list - separate from the
// per-list add box, which stays in place until this is confirmed working.
// See docs/adr/0003 for the original staged scope, docs/adr/0004 for the
// Events web-search tier, docs/adr/0006 for the multi-source search step
// added here.
export default function AddToListsButton({
  systemLists,
  listContext,
}: {
  systemLists: SystemList[];
  listContext?: ListContext;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEntry | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [externalId, setExternalId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [eventSources, setEventSources] = useState<{ url: string; title: string }[] | null>(null);
  const [destChecked, setDestChecked] = useState(true);

  // null = that source hasn't responded yet, [] = responded with nothing.
  // Two separate pieces of state so each source's section of the results
  // list renders the moment it resolves, independent of the other.
  const [wikidataResults, setWikidataResults] = useState<SearchCandidate[] | null>(null);
  const [webResults, setWebResults] = useState<SearchCandidate[] | null>(null);

  function reset() {
    setInput("");
    setStep("input");
    setErrorMsg(null);
    setSourceUrl(null);
    setPending(null);
    setTitle("");
    setSubtitle("");
    setExternalId(null);
    setImageUrl(null);
    setEventDate(null);
    setEventSources(null);
    setDestChecked(true);
    setWikidataResults(null);
    setWebResults(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function resolveAndShowConfirm(body: { url?: string; query?: string; hintType?: string }) {
    setStep("parsing");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Could not resolve that.");
        setStep("error");
        return;
      }
      const parsed = data.parsed;
      setSourceUrl(data.sourceUrl ?? null);
      setTitle(parsed.title ?? "");
      setSubtitle(parsed.subtitle ?? "");
      setExternalId(parsed.external_id ?? null);
      setImageUrl(parsed.image_url ?? null);
      setEventDate(parsed.date ?? null);
      setEventSources(parsed.sources ?? null);
      setPending({
        category: parsed.type,
        provenance: data.provenance ?? null,
        sourceLabel: parsed.source === "unsupported" ? "Unsupported" : PROVENANCE_LABEL[data.provenance as ResolutionProvenance] ?? "Unknown",
        message: parsed.message,
        sourceCount: parsed.sources?.length,
      });
      setDestChecked(true);
      setStep("confirm");
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStep("error");
    }
  }

  function runMultiSearch(query: string, category: string) {
    setStep("results");
    setErrorMsg(null);
    setWikidataResults(null);
    setWebResults(null);

    // Two independent, parallel requests - each updates its own state the
    // instant it resolves. Wikidata is documented running slow under load
    // (9-27s), so this is what keeps a fast web-search response from
    // waiting on it, and vice versa.
    fetch("/api/search/wikidata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, category }),
    })
      .then((res) => res.json())
      .then((data) => setWikidataResults(data.candidates ?? []))
      .catch(() => setWikidataResults([]));

    fetch("/api/search/web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, category }),
    })
      .then((res) => res.json())
      .then((data) => setWebResults(data.candidates ?? []))
      .catch(() => setWebResults([]));
  }

  function selectCandidate(c: SearchCandidate) {
    setTitle(c.title);
    setSubtitle(c.subtitle ?? "");
    setExternalId(c.external_id);
    setImageUrl(c.image_url);
    setSourceUrl(null); // no literal pasted URL behind a search-selected candidate
    setEventDate(null);
    setEventSources(null);
    setPending({
      category: c.category,
      provenance: c.provenance,
      sourceLabel: c.sourceLabel,
    });
    setDestChecked(true);
    setStep("confirm");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    if (!looksLikeUrl(trimmed)) {
      if (listContext && MULTI_SEARCH_CATEGORIES.includes(listContext.type)) {
        runMultiSearch(trimmed, listContext.type);
        return;
      }
      // Events also supports a single-answer typed description (its own
      // web-search tier, pre-dating this multi-result step) - kept as the
      // fallback so a specific, unambiguous description still works even
      // though Events also now gets full multi-source results above.
      setStep("typed-unsupported");
      return;
    }

    await resolveAndShowConfirm({ url: normalizeUrl(trimmed), hintType: listContext?.type });
  }

  const destination = pending ? systemLists.find((l) => l.type === pending.category) : undefined;

  async function handleConfirm() {
    if (!pending || !destination || !destChecked) return;
    setStep("saving");
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listSlug: destination.slug,
          type: pending.category,
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          image_url: imageUrl,
          source_url: sourceUrl,
          external_id: externalId,
          provenance: pending.provenance,
          date: eventDate,
          sources: eventSources,
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

  const sortedWikidata = wikidataResults ? sortByContext(wikidataResults, listContext?.type) : null;
  const sortedWeb = webResults ? sortByContext(webResults, listContext?.type) : null;
  const resultsLoaded = wikidataResults !== null && webResults !== null;
  const noResults = resultsLoaded && sortedWikidata!.length === 0 && sortedWeb!.length === 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 z-40 flex items-center justify-center rounded-full text-white shadow-lg"
        style={{ background: "var(--rust)", width: 52, height: 52, bottom: 84 }}
        aria-label="Add to Lists"
      >
        <span className="text-2xl leading-none" aria-hidden>+</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={close}>
          <div
            className="w-full max-w-md mx-auto bg-white rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-2xl" style={{ color: "var(--rust)" }}>
                Add to Lists
              </h2>
              <button onClick={close} className="text-sm opacity-50">Close</button>
            </div>
            {listContext && (
              <p className="text-xs opacity-50 mb-3">Adding from {listContext.name}</p>
            )}

            {step === "input" && (
              <form onSubmit={handleSubmit} className="mt-3">
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    listContext && MULTI_SEARCH_CATEGORIES.includes(listContext.type)
                      ? "Paste a link, or search by name"
                      : "Paste a link"
                  }
                  className="w-full border rounded-md px-3 py-2 text-sm mb-3"
                />
                <button
                  className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white"
                  style={{ background: "var(--rust)" }}
                >
                  Continue
                </button>
              </form>
            )}

            {step === "typed-unsupported" && (
              <div className="mt-3">
                <p className="text-sm opacity-70 mb-4">
                  Paste a link for now — typed search is coming soon.
                </p>
                <button onClick={() => setStep("input")} className="text-sm px-3 py-1.5 rounded-md border">
                  Back
                </button>
              </div>
            )}

            {step === "parsing" && (
              <p className="text-sm opacity-60 mt-3">
                {listContext?.type === "event" ? "Searching for that event..." : "Reading that link..."}
              </p>
            )}

            {step === "results" && (
              <div className="mt-3">
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-wide opacity-50 mb-1.5">Wikidata</p>
                  {sortedWikidata === null && <p className="text-xs opacity-40">Searching...</p>}
                  {sortedWikidata !== null && sortedWikidata.length === 0 && (
                    <p className="text-xs opacity-40">No matches.</p>
                  )}
                  <div className="space-y-1.5">
                    {sortedWikidata?.map((c, i) => (
                      <CandidateRow key={`wd-${i}`} candidate={c} systemLists={systemLists} onSelect={() => selectCandidate(c)} />
                    ))}
                  </div>
                </div>

                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-wide opacity-50 mb-1.5">Web search</p>
                  {sortedWeb === null && <p className="text-xs opacity-40">Searching...</p>}
                  {sortedWeb !== null && sortedWeb.length === 0 && (
                    <p className="text-xs opacity-40">No matches.</p>
                  )}
                  <div className="space-y-1.5">
                    {sortedWeb?.map((c, i) => (
                      <CandidateRow key={`web-${i}`} candidate={c} systemLists={systemLists} onSelect={() => selectCandidate(c)} />
                    ))}
                  </div>
                </div>

                {noResults && (
                  <p className="text-xs opacity-50 mb-3">
                    Nothing found. Try different words, or paste a link instead.
                  </p>
                )}

                <button onClick={() => setStep("input")} className="text-sm px-3 py-1.5 rounded-md border">
                  Back
                </button>
              </div>
            )}

            {step === "error" && (
              <div className="mt-3">
                <p className="text-red-600 text-sm mb-4">{errorMsg}</p>
                <button onClick={() => setStep("input")} className="text-sm px-3 py-1.5 rounded-md border">
                  Try again
                </button>
              </div>
            )}

            {step === "confirm" && pending && (
              <div className="mt-3">
                {pending.message ? (
                  <p className="text-sm opacity-70 mb-3">{pending.message}</p>
                ) : (
                  <p className="text-[10px] uppercase tracking-wide opacity-50 mb-2">
                    {destination?.name ?? pending.category} &middot; {pending.sourceLabel}
                    {pending.sourceCount !== undefined &&
                      ` · ${pending.sourceCount} source${pending.sourceCount === 1 ? "" : "s"}`}
                    {(pending.provenance === "web_search" || pending.provenance === "ai_guess") &&
                      " · please verify"}
                  </p>
                )}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full border rounded-md px-3 py-2 text-sm mb-2 font-medium"
                />
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Artist / location / year"
                  className="w-full border rounded-md px-3 py-2 text-sm mb-3 opacity-70"
                />

                {destination ? (
                  <label className="flex items-center gap-2 text-sm mb-4">
                    <input
                      type="checkbox"
                      checked={destChecked}
                      onChange={(e) => setDestChecked(e.target.checked)}
                    />
                    {destination.name}
                  </label>
                ) : (
                  <p className="text-xs opacity-50 mb-4">No matching list for this yet.</p>
                )}

                <button
                  onClick={handleConfirm}
                  disabled={!title.trim() || !destination || !destChecked}
                  className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white disabled:opacity-40"
                  style={{ background: "var(--rust)" }}
                >
                  Add it
                </button>
              </div>
            )}

            {step === "saving" && <p className="text-sm opacity-60 mt-3">Saving...</p>}

            {step === "done" && (
              <div className="mt-3">
                <p className="text-sm mb-4">Added to {destination?.name}.</p>
                <button
                  onClick={close}
                  className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white"
                  style={{ background: "var(--rust)" }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CandidateRow({
  candidate,
  systemLists,
  onSelect,
}: {
  candidate: SearchCandidate;
  systemLists: SystemList[];
  onSelect: () => void;
}) {
  const categoryName = systemLists.find((l) => l.type === candidate.category)?.name ?? candidate.category;
  return (
    <button
      onClick={onSelect}
      className="w-full text-left bg-white border rounded-md px-3 py-2 hover:border-black/30 transition"
    >
      <p className="text-sm font-medium">{candidate.title}</p>
      {candidate.subtitle && <p className="text-xs opacity-60 truncate">{candidate.subtitle}</p>}
      <p className="text-[10px] uppercase tracking-wide opacity-40 mt-1">
        {categoryName} &middot; {PROVENANCE_LABEL[candidate.provenance]}
      </p>
    </button>
  );
}

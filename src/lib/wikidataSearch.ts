import type { EntryType } from "@/lib/parseLink";

export type WikidataCandidate = {
  qid: string;
  label: string;
  description: string | null;
  category: EntryType;
};

// Public, keyless, no auth required - verified live before building against
// it. wbsearchentities is a fuzzy name-search action, distinct from the
// SPARQL query service (used later for exact handle-property enrichment
// matches, not built yet - see docs/adr/0006). Scoped to Films/Events/
// Issues only: Creator matching per api-integrations-addendum.md needs an
// exact handle-property SPARQL match (P2002/P2003/P7085/P2397), a
// different mechanism this function doesn't attempt.
const WIKIDATA_UA = "Mozilla/5.0 (compatible; PeakFeedBot/0.1; +https://peakfeed.app)";

/**
 * Guesses which system-list category a Wikidata result belongs to from its
 * own description text ("2010 film directed by...", "annual music
 * festival in..."). A heuristic, not a certainty - falls back to the
 * category the search was scoped to when the description gives no strong
 * signal, rather than guessing wrong with false confidence.
 */
function categorizeWikidataResult(description: string | null, requestedCategory: EntryType): EntryType {
  const d = (description ?? "").toLowerCase();
  if (/\bfilm\b|\bmovie\b/.test(d)) return "movie";
  if (/\bfestival\b|\bconcert\b|\bconvention\b|\bsports event\b|\b(annual|recurring) event\b/.test(d)) {
    return "event";
  }
  if (/\bsocial (movement|issue)\b|\bpolitical (issue|movement|controversy)\b|\bcontroversy\b/.test(d)) {
    return "issue";
  }
  return requestedCategory;
}

export async function searchWikidata(query: string, category: EntryType, limit = 5): Promise<WikidataCandidate[]> {
  try {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbsearchentities");
    url.searchParams.set("search", query);
    url.searchParams.set("language", "en");
    url.searchParams.set("type", "item");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": WIKIDATA_UA },
      // The public query service has been documented running 9-27s under
      // load - give this real headroom rather than timing out prematurely
      // on a source that's meant to just populate whenever it's ready.
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results: { id: string; label?: string; title?: string; description?: string }[] = data.search ?? [];
    return results.map((item) => ({
      qid: item.id,
      label: item.label ?? item.title ?? item.id,
      description: item.description ?? null,
      category: categorizeWikidataResult(item.description ?? null, category),
    }));
  } catch {
    return [];
  }
}

import type { EntryType } from "@/lib/parseLink";

export type WikidataCandidate = {
  qid: string;
  label: string;
  description: string | null;
  category: EntryType;
};

// Public, keyless, no auth required - verified live before building against
// it. wbsearchentities is a fuzzy name-search action, distinct from the
// SPARQL query service (searchWikidataByHandle below, exact handle-property
// match). Scoped to Films/Events/Issues only: Creator matching per
// api-integrations-addendum.md needs an exact handle-property match
// instead, a different mechanism this function doesn't attempt.
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

// The four platform-specific handle properties Creator matching keys off,
// per api-integrations-addendum.md section 2. One list-type per platform
// (not a single combined "Creator" type), so each needs its own property.
const HANDLE_PROPERTY: Partial<Record<EntryType, string>> = {
  x_creator: "P2002",
  instagram_creator: "P2003",
  tiktok_creator: "P7085",
  youtube_creator: "P2397",
};

/**
 * Exact handle-property match via the SPARQL query service - distinct from
 * searchWikidata's fuzzy name search above. A typed handle either is or
 * isn't the exact value Wikidata has recorded for that platform's property
 * on some item; there's no fuzzy-match sense in which two different
 * handles both "sort of" match, so this returns at most a handful of exact
 * hits rather than a ranked list of guesses.
 */
export async function searchWikidataByHandle(
  handle: string,
  category: EntryType,
  limit = 5
): Promise<WikidataCandidate[]> {
  const property = HANDLE_PROPERTY[category];
  const cleaned = handle.trim().replace(/^@/, "");
  if (!property || !cleaned) return [];

  // Deliberately NOT a FILTER(LCASE(...)) comparison - verified live that
  // it forces an unindexed scan over every value of the property and times
  // out (502 from the query service) instead of returning. A VALUES clause
  // with a couple of case variants still lets the query planner use the
  // property's value index, the same as a single exact match, so this
  // covers the common "platform is case-insensitive but a contributor
  // recorded a different case" mismatch without the scan cost.
  const variants = Array.from(new Set([cleaned, cleaned.toLowerCase(), cleaned.toUpperCase()]));
  const escaped = variants.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(" ");
  const sparql = `SELECT ?item ?itemLabel ?handle WHERE {
    VALUES ?handle { ${escaped} }
    ?item wdt:${property} ?handle .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT ${limit}`;

  try {
    const url = new URL("https://query.wikidata.org/sparql");
    url.searchParams.set("query", sparql);
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": WIKIDATA_UA, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const bindings: { item: { value: string }; itemLabel?: { value: string }; handle?: { value: string } }[] =
      data?.results?.bindings ?? [];
    return bindings.map((b) => ({
      qid: b.item.value.split("/").pop() ?? b.item.value,
      label: b.itemLabel?.value ?? cleaned,
      description: `@${b.handle?.value ?? cleaned}`,
      category,
    }));
  } catch {
    return [];
  }
}

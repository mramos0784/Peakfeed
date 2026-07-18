import Anthropic from "@anthropic-ai/sdk";

export type EntryType =
  | "song"
  | "restaurant"
  | "venue"
  | "movie"
  | "event"
  | "issue"
  | "custom"
  // Four platform-specific Creator types (schema-only so far - no
  // resolution logic targets these yet, kept in sync with the entry_type
  // enum in supabase/schema.sql so the two don't silently diverge).
  | "x_creator"
  | "tiktok_creator"
  | "instagram_creator"
  | "youtube_creator";

export interface ParsedEntry {
  type: EntryType;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  confidence: "high" | "medium" | "low";
  source: "spotify_page" | "url_id" | "ai" | "unsupported" | "web_search";
  // Set only when source is "unsupported" - a human-readable reason to show
  // instead of a pre-filled guess.
  message?: string;
  // Events only, from the "web_search" path: the confirmed date (YYYY-MM-DD)
  // and the public pages actually found, straight from the API's own search
  // result blocks - never something the model typed into its JSON answer.
  date?: string | null;
  sources?: { url: string; title: string }[];
}

// Matches the resolution_provenance enum in supabase/schema.sql (ADR 0005).
// Kept as its own type rather than reusing ParsedEntry["source"] - source
// is the resolution *pipeline's* internal vocabulary (spotify_page, ai,
// etc.), provenance is what actually gets persisted to entries and shown
// to users, and the two aren't quite the same shape (e.g. "unsupported"
// is a source but never a provenance, since nothing gets created from it).
export type ResolutionProvenance =
  | "direct_api"
  | "url_id"
  | "wikidata_match"
  | "web_search"
  | "ai_guess"
  | "manual"
  // A normalized title+artist / name+city key PeakFeed computed itself
  // (src/lib/normalize.ts), used only when Songs/Restaurants/Venues have
  // no real external id to fall back on. Distinct from every other tier:
  // this is a best-effort match, not anything verified against an
  // external source.
  | "internal_key";

// The one place that maps a ParsedEntry's internal `source` to the
// persisted `provenance` value - keeps every save path (single-link
// resolve, multi-candidate search) consistent instead of each caller
// inventing its own mapping.
export function sourceToProvenance(source: ParsedEntry["source"]): ResolutionProvenance | null {
  switch (source) {
    case "spotify_page":
    case "url_id":
      return "url_id";
    case "ai":
      return "ai_guess";
    case "web_search":
      return "web_search";
    case "unsupported":
      return null; // nothing is ever created from this source
  }
}

// One normalized candidate from a multi-result search - the shape both
// /api/search/wikidata and /api/search/web return, so the client can
// merge and render them identically regardless of source.
export type SearchCandidate = {
  category: EntryType;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  provenance: ResolutionProvenance;
  sourceLabel: string;
};

const CATEGORY_LABELS: Partial<Record<EntryType, string>> = {
  movie: "Movies",
  event: "Events",
  issue: "Issues",
  x_creator: "X Creator",
  tiktok_creator: "TikTok Creator",
  instagram_creator: "Instagram Creator",
  youtube_creator: "YouTube Creator",
};

const CANDIDATE_SEARCH_MAX_USES = 5;

/**
 * Web search, but enumerating several candidates instead of converging on
 * one answer - distinct from webSearchExtractEvent, which is for a
 * specific pasted link/description the user already disambiguated. This is
 * for a typed, possibly-ambiguous search query where the user still needs
 * to pick from multiple results. Used for the simultaneous Wikidata +
 * web-search flow (Films/Events/Issues/Creators) - see docs/adr/0006.
 */
export async function webSearchCandidates(query: string, category: EntryType): Promise<SearchCandidate[]> {
  const categoryLabel = CATEGORY_LABELS[category] ?? category;
  const prompt = `A user is searching PeakFeed, a community ranking app, for a
"${categoryLabel}" entry matching: "${query}"

Use web search to find up to 5 real, distinct candidates that could match
this search - not just your single best guess, several plausible matches
if more than one genuinely exists (e.g. a film and its remake, two public
figures with a similar name). Assume the Tampa Bay, Florida area for
anything locally ambiguous, unless the query clearly says otherwise.

After searching, respond with ONLY a JSON array as your final message, no
other text, matching this shape:
[
  { "title": string, "subtitle": string | null }
]
Only include real things you found evidence for via search - fewer than 5
is fine, and an empty array [] is the right answer if nothing plausible
turns up.`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: CANDIDATE_SEARCH_MAX_USES,
          user_location: { type: "approximate", city: "Tampa", region: "Florida", country: "US" },
        },
      ],
    });
  } catch (err) {
    console.error("web search candidates failed", err);
    return [];
  }

  const textBlocks = message.content.filter((b) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1]?.text ?? "[]";
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastText);
  } catch {
    const match = lastText.match(/\[[\s\S]*\]/);
    try {
      parsed = match ? JSON.parse(match[0]) : [];
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) {
    console.error("web search candidates: response wasn't a JSON array", {
      stopReason: message.stop_reason,
      lastTextPreview: lastText.slice(0, 200),
    });
    return [];
  }

  return (parsed as { title?: string; subtitle?: string | null }[])
    .filter((c) => c.title && !isLowInformationTitle(c.title))
    .map((c) => ({
      category,
      title: c.title as string,
      subtitle: c.subtitle ?? null,
      image_url: null,
      external_id: null,
      provenance: "web_search" as const,
      sourceLabel: "Web search",
    }));
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Counterintuitively, identifying as a bot gets the real, pre-rendered page
// with full meta tags. A real-browser UA gets Spotify's JS-only app shell
// instead, which has none of the data we need until client-side JS runs.
const CRAWLER_UA = "Mozilla/5.0 (compatible; PeakFeedBot/0.1; +https://peakfeed.app)";

// Sources with no real metadata to scrape, ever - short-circuit before any
// network call instead of presenting a bogus AI guess built from nothing.
// Amazon Music has no Tier 1 path until an OAuth integration exists (see
// share-ingestion-addendum.md); share.google is Google's own Share-button
// shortener, it wraps a search result / knowledge panel, not the actual page.
const UNSUPPORTED_SOURCES: { test: (host: string) => boolean; message: string }[] = [
  {
    test: (host) => host === "music.amazon.com" || host.endsWith(".music.amazon.com"),
    message: "Can't auto-detect Amazon Music links yet — search below.",
  },
  {
    test: (host) => host === "share.google" || host.endsWith(".share.google"),
    message: "Can't auto-detect this one — search below.",
  },
];

function checkUnsupportedSource(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return UNSUPPORTED_SOURCES.find((s) => s.test(host))?.message ?? null;
}

// Exact phrases a scraped <title> or og:title sometimes comes back as when
// the request hit an interstitial instead of the real page - login walls,
// bot checks, loading shells, error pages. None of these are ever a real
// title for a song/restaurant/venue/movie/event.
const LOW_INFO_EXACT_TITLES = new Set([
  "google search", "sign in", "sign in to continue", "log in", "login",
  "just a moment", "just a moment...", "loading", "loading...",
  "attention required", "access denied", "forbidden", "error",
  "page not found", "not found", "404", "404 not found", "untitled",
  "redirecting", "redirecting...", "please wait", "please wait...",
  "one moment", "one moment please", "verify you are human",
  "checking your browser", "session expired", "are you a robot",
  "unusual traffic detected", "sorry", "oops", "forbidden access",
]);

// A short (1-2 word) title built entirely out of this vocabulary reads as
// interstitial chrome, not a real title - "Sign In", "Access Denied". Real
// short titles (movies, songs) are common and almost never composed only of
// these words, so this only rejects the short, generic case, not short
// titles in general.
const CHROME_VOCAB = new Set([
  "sign", "in", "log", "login", "loading", "search", "welcome", "home",
  "verify", "verifying", "checking", "redirect", "redirecting", "error",
  "denied", "forbidden", "expired", "wait", "moment", "robot", "human",
  "captcha", "sorry", "oops", "unavailable", "blocked", "access", "browser",
]);

/**
 * A generalized guard against presenting a scraped/bot-block/interstitial
 * string as if it were a real title - broader than matching specific known
 * phrases one at a time, since new bot-block variants show up constantly.
 * Two checks: an exact-phrase denylist for the common cases, plus a
 * generic-vocabulary check for short titles that are clearly chrome rather
 * than content. Deliberately does NOT reject all short titles - "Up",
 * "Jaws", "Barbie" are real, common, and would otherwise get wrongly
 * flagged.
 */
function isLowInformationTitle(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase().replace(/[.…\s]+$/, "");
  if (LOW_INFO_EXACT_TITLES.has(normalized)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length < 3) {
    const allGeneric = words.every((w) =>
      CHROME_VOCAB.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    );
    if (allGeneric) return true;
  }
  return false;
}

/**
 * Pull one meta tag's content out of raw HTML without assuming attribute
 * order. Real-world HTML doesn't guarantee property="..." comes before
 * content="...", so this scans each whole <meta> tag and checks both
 * attributes independently instead of one combined regex.
 */
function extractMetaContent(html: string, propertyOrName: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (key && key.toLowerCase() === propertyOrName.toLowerCase()) {
      const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
      if (content) return content.trim();
    }
  }
  return null;
}

/**
 * Turn a shared URL into a structured entry, ready for the user to confirm.
 *
 * Order of preference, cheapest and most reliable first:
 *   1. The Spotify track page's own meta tags - free, no API key, no OAuth,
 *      and includes a dedicated artist field (music:musician_description),
 *      unlike Spotify's oEmbed endpoint which only returns the song title.
 *   2. An ID already sitting in the URL itself (Google Maps place id/cid) -
 *      free, no network call needed beyond what already happened.
 *   3. Claude, reading the page's own title/meta tags - the fallback for
 *      Instagram links, plain article links, anything with no clean id.
 *
 * No TMDB tier: TMDB's API requires a paid commercial license for this kind
 * of use, so it's not in the mix (removed after briefly landing - see
 * ADR 0003's update note). TMDB/IMDb links fall through to Claude like any
 * other link until a non-commercial alternative is wired in.
 *
 * This intentionally does NOT hand dedup fully to the model. Whenever an
 * earlier step finds a real identifier, that id is what entries.external_id
 * gets set to, and the database's unique index does exact-match dedup on it.
 * Claude only fills in the fields for the messy cases where no id exists.
 */
export async function parseLink(url: string, hintType?: EntryType): Promise<ParsedEntry> {
  const unsupportedMessage = checkUnsupportedSource(url);
  if (unsupportedMessage) {
    return {
      type: hintType ?? "custom",
      title: "",
      subtitle: null,
      image_url: null,
      external_id: null,
      confidence: "low",
      source: "unsupported",
      message: unsupportedMessage,
    };
  }

  // Events have no direct-API tier (Ticketmaster/Eventbrite both ruled out -
  // see ADR 0003's update notes) and no clean id sitting in a Facebook/venue
  // URL the way Google Maps links carry a place id. Web search stands in for
  // both: confirming the event and finding whatever other public listings
  // exist for it, which get attached as sources on the entry.
  if (hintType === "event") {
    return webSearchExtractEvent(url, true);
  }

  const spotify = tryExtractSpotify(url);
  if (spotify) {
    const meta = await fetchSpotifyTrackMeta(url);
    if (meta) {
      return {
        type: "song",
        title: meta.title,
        subtitle: meta.artist,
        image_url: meta.thumbnail_url,
        external_id: spotify.id,
        confidence: "high",
        source: "spotify_page",
      };
    }
    return aiExtract(url, hintType, spotify.id);
  }

  const mapsId = tryExtractGoogleMapsId(url);
  if (mapsId) {
    return aiExtract(url, hintType ?? "restaurant", mapsId);
  }

  return aiExtract(url, hintType, null);
}

// Entry point for typed free text describing an event (no link at all) -
// the AddToListsButton's typed-text path, Events only. There's nothing to
// fetch, so this skips straight to web search with the raw description as
// context instead of a URL.
export async function parseEventQuery(query: string): Promise<ParsedEntry> {
  return webSearchExtractEvent(query, false);
}

function tryExtractSpotify(url: string): { id: string } | null {
  const match = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? { id: `spotify:${match[1]}` } : null;
}

async function fetchSpotifyTrackMeta(
  url: string
): Promise<{ title: string; artist: string; thumbnail_url: string | null } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": CRAWLER_UA },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const title = extractMetaContent(html, "og:title");
    const artist = extractMetaContent(html, "music:musician_description");
    const image = extractMetaContent(html, "og:image");
    if (!title || isLowInformationTitle(title)) return null;
    return { title, artist: artist ?? "Unknown artist", thumbnail_url: image };
  } catch {
    return null;
  }
}

function tryExtractGoogleMapsId(url: string): string | null {
  if (!/google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/.test(url)) return null;
  try {
    const u = new URL(url);
    const placeId = u.searchParams.get("place_id") ?? u.searchParams.get("query_place_id");
    if (placeId) return `google_place:${placeId}`;
    const ftid = u.searchParams.get("ftid");
    if (ftid) return `google_ftid:${ftid}`;
  } catch {
    // fall through, short links (goo.gl/maps) need to be resolved first,
    // which the fetch in aiExtract will do by following the redirect.
  }
  return null;
}

async function fetchPageMeta(url: string): Promise<{
  finalUrl: string;
  title: string | null;
  description: string | null;
  image: string | null;
}> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": CRAWLER_UA },
    });
    const html = (await res.text()).slice(0, 50_000); // cap what we read
    const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
    const rawTitle = extractMetaContent(html, "og:title") ?? titleTag;
    return {
      finalUrl: res.url || url,
      // A bot-block/login/interstitial page has no real title, so treat it
      // the same as no title at all rather than passing it downstream -
      // both as a fallback value and as context in the AI prompt below.
      title: rawTitle && !isLowInformationTitle(rawTitle) ? rawTitle : null,
      description:
        extractMetaContent(html, "og:description") ?? extractMetaContent(html, "description"),
      image: extractMetaContent(html, "og:image"),
    };
  } catch {
    return { finalUrl: url, title: null, description: null, image: null };
  }
}

async function aiExtract(
  url: string,
  hintType: EntryType | undefined,
  knownId: string | null
): Promise<ParsedEntry> {
  const meta = await fetchPageMeta(url);
  const resolvedId = knownId ?? tryExtractGoogleMapsId(meta.finalUrl);

  const prompt = `A user shared this link with PeakFeed, a community ranking app.
Extract structured info about the single thing being shared so it can be added
to a ranked list.

URL: ${meta.finalUrl}
Page title: ${meta.title ?? "(none found)"}
Page description: ${meta.description ?? "(none found)"}
${hintType ? `The user is adding this to their "${hintType}" list.` : "Guess which list type this belongs to."}

Respond with ONLY a JSON object, no other text, matching this shape:
{
  "type": "song" | "restaurant" | "venue" | "movie" | "event" | "issue" | "custom" | "x_creator" | "tiktok_creator" | "instagram_creator" | "youtube_creator",
  "title": string,
  "subtitle": string | null,
  "confidence": "high" | "medium" | "low"
}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content.find((b) => b.type === "text")?.text ?? "{}";
  let parsed: { type?: EntryType; title?: string; subtitle?: string; confidence?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  // Claude can only repeat back what the prompt gave it, so a bad scrape can
  // still surface as a confident-looking guess. Re-check its title too
  // rather than trusting the model to have caught it - if what's left is
  // nothing usable, leave the field blank and force low confidence instead
  // of inventing a placeholder like "Untitled" that reads as a real answer.
  const aiTitle = parsed.title && !isLowInformationTitle(parsed.title) ? parsed.title : null;
  const finalTitle = aiTitle ?? meta.title ?? "";

  return {
    type: parsed.type ?? hintType ?? "custom",
    title: finalTitle,
    subtitle: parsed.subtitle ?? null,
    image_url: meta.image,
    external_id: resolvedId,
    confidence: finalTitle ? ((parsed.confidence as ParsedEntry["confidence"]) ?? "low") : "low",
    source: "ai",
  };
}

// Strips an event name down to a comparable form: lowercase, punctuation
// gone, whitespace collapsed. Used both to build the dedup key below and to
// compare two differently-worded shares of the same event (see tokenOverlap).
export function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Jaccard-style token overlap between two event names - the free, local,
// "Tier 2" fuzzy match intelligence-layer.md describes, used at insert time
// to catch two independently-worded shares of the same real event (a
// Facebook page's title rarely matches an Eventbrite listing's title
// character-for-character, even for the identical show).
export function tokenOverlap(a: string, b: string): number {
  const tokenize = (s: string) => new Set(normalizeEventName(s).split(" ").filter(Boolean));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const tok of setA) if (setB.has(tok)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

const EVENT_SEARCH_MAX_USES = 5;

// Events have no direct-API resolution tier (see the note in parseLink), so
// this is the whole path: hand Claude either the pasted link or the user's
// own description, let it use real web search to confirm the event and find
// other public listings for it, then read the actual result URLs back out of
// the API response - never trust a URL the model might type into its JSON
// answer, since that's exactly the kind of plausible-but-wrong string the
// low-information-title guard elsewhere in this file exists to catch.
async function webSearchExtractEvent(input: string, isUrl: boolean): Promise<ParsedEntry> {
  const context = isUrl
    ? `A user shared this link with PeakFeed, a community ranking app, as an event: ${input}`
    : `A user described this event to PeakFeed, a community ranking app, in their own words: "${input}"`;

  const prompt = `${context}

Use web search to confirm the real-world event this refers to, and find other
public listing pages for it if they exist (a Facebook Events page, an
Eventbrite listing, the venue's own site, local news coverage). Assume the
Tampa Bay, Florida area unless the input clearly says otherwise.

After searching, respond with ONLY a JSON object as your final message, no
other text, matching this shape:
{
  "title": string,
  "venue": string | null,
  "date": string | null,
  "confidence": "high" | "medium" | "low"
}
Treat "is this a real, identifiable event" and "what's the exact date" as
separate questions. Fill in "title" (and "venue" if you found one) whenever
the search results confirm this is a genuine event, even if you're not
fully certain of the single exact date - give your best title based on what
you found either way. "date" must be YYYY-MM-DD, or null specifically if
the date itself isn't confirmable (a multi-day event, conflicting sources,
still TBD) - that's a reason to leave "date" null, not "title" empty.
Only set "title" to "" if the search results show no evidence this event
exists at all.`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      // A multi-search tool-use turn needs real headroom: the model's own
      // interstitial reasoning between searches plus the final JSON answer
      // can exceed a small budget before it ever gets to respond, silently
      // truncating the response before the JSON we actually need.
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: EVENT_SEARCH_MAX_USES,
          user_location: { type: "approximate", city: "Tampa", region: "Florida", country: "US" },
        },
      ],
    });
  } catch (err) {
    console.error("web search for event failed", err);
    return {
      type: "event",
      title: "",
      subtitle: null,
      image_url: null,
      external_id: null,
      confidence: "low",
      source: "web_search",
      date: null,
      sources: [],
    };
  }

  // Source pages Claude actually found, read straight from the API's own
  // search result blocks, not from anything the model typed into its JSON.
  const sources: { url: string; title: string }[] = [];
  for (const block of message.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === "web_search_result") {
          sources.push({ url: result.url, title: result.title });
        }
      }
    }
  }

  const textBlocks = message.content.filter((b) => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1]?.text ?? "{}";
  let parsed: { title?: string; venue?: string | null; date?: string | null; confidence?: string };
  try {
    parsed = JSON.parse(lastText);
  } catch {
    // The model didn't respond with pure JSON despite instructions - try
    // pulling a JSON object out of whatever surrounding text it added
    // rather than giving up immediately.
    const match = lastText.match(/\{[\s\S]*\}/);
    try {
      parsed = match ? JSON.parse(match[0]) : {};
    } catch {
      parsed = {};
    }
  }

  if (!parsed.title && sources.length > 0) {
    // Sources were found but no usable title came back - worth knowing
    // whether this is the model genuinely declining or the response got
    // cut off mid-turn (stop_reason would show "max_tokens" or
    // "pause_turn" instead of "end_turn").
    console.error("event web search: no title despite sources", {
      stopReason: message.stop_reason,
      sourceCount: sources.length,
      lastTextPreview: lastText.slice(0, 200),
    });
  }

  const title = parsed.title && !isLowInformationTitle(parsed.title) ? parsed.title : "";
  if (!title) {
    return {
      type: "event",
      title: "",
      subtitle: null,
      image_url: null,
      external_id: null,
      confidence: "low",
      source: "web_search",
      date: null,
      sources,
    };
  }

  const date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
  // Reduced PeakFeed Event ID: date + normalized name only, no venue (Place
  // ID resolution doesn't exist yet for any category) and deliberately no
  // submitting user - baking the submitter into an exact-match dedup key
  // would mean the same real event shared by two different people never
  // collapses into one entry, which defeats the entire point of this
  // identifier. Submitter provenance is already tracked structurally via
  // entries.created_by and each list_items.added_by.
  const externalId = date ? `event:${date}:${normalizeEventName(title)}` : null;
  const subtitle = [parsed.venue, date].filter(Boolean).join(" · ") || null;

  return {
    type: "event",
    title,
    subtitle,
    image_url: null,
    external_id: externalId,
    // Always low - web-search-sourced results are never as trustworthy as a
    // direct API match, regardless of how confident Claude's own JSON claims
    // to be.
    confidence: "low",
    source: "web_search",
    date,
    sources,
  };
}
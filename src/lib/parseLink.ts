import Anthropic from "@anthropic-ai/sdk";

export type EntryType =
  | "song"
  | "restaurant"
  | "venue"
  | "movie"
  | "event"
  | "issue"
  | "custom";

export interface ParsedEntry {
  type: EntryType;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  confidence: "high" | "medium" | "low";
  source: "spotify_page" | "url_id" | "ai" | "unsupported";
  // Set only when source is "unsupported" - a human-readable reason to show
  // instead of a pre-filled guess.
  message?: string;
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
  "type": "song" | "restaurant" | "venue" | "movie" | "event" | "issue" | "custom",
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
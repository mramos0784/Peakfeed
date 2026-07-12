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
  source: "spotify_page" | "url_id" | "ai";
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Counterintuitively, identifying as a bot gets the real, pre-rendered page
// with full meta tags. A real-browser UA gets Spotify's JS-only app shell
// instead, which has none of the data we need until client-side JS runs.
const CRAWLER_UA = "Mozilla/5.0 (compatible; PeakFeedBot/0.1; +https://peakfeed.app)";

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
 * This intentionally does NOT hand dedup fully to the model. Whenever step 1
 * or 2 finds a real identifier, that id is what entries.external_id gets set
 * to, and the database's unique index does exact-match dedup on it. Claude
 * only fills in the fields for the messy cases where no id exists at all.
 */
export async function parseLink(url: string, hintType?: EntryType): Promise<ParsedEntry> {
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
    if (!title) return null;
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
    return {
      finalUrl: res.url || url,
      title: extractMetaContent(html, "og:title") ?? titleTag,
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

  return {
    type: parsed.type ?? hintType ?? "custom",
    title: parsed.title ?? meta.title ?? "Untitled",
    subtitle: parsed.subtitle ?? null,
    image_url: meta.image,
    external_id: resolvedId,
    confidence: (parsed.confidence as ParsedEntry["confidence"]) ?? "low",
    source: "ai",
  };
}
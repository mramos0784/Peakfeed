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
  source: "spotify_oembed" | "url_id" | "ai";
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Turn a shared URL into a structured entry, ready for the user to confirm.
 *
 * Order of preference, cheapest and most reliable first:
 *   1. Spotify oEmbed - free, no API key, no OAuth, gives an exact title/artist.
 *   2. An ID already sitting in the URL itself (Spotify track id, Google Maps
 *      place id/cid) - free, no network call needed beyond what already happened.
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
    const oembed = await trySpotifyOEmbed(url);
    if (oembed) {
      return {
        type: "song",
        title: oembed.title,
        subtitle: oembed.artist,
        image_url: oembed.thumbnail_url,
        external_id: spotify.id,
        confidence: "high",
        source: "spotify_oembed",
      };
    }
    // oEmbed failed (rate limited, private track, etc) but we still have the id.
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

async function trySpotifyOEmbed(
  url: string
): Promise<{ title: string; artist: string; thumbnail_url: string | null } | null> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // oEmbed's "title" field for tracks comes back as "Song Name" and
    // "author_name" as the artist. Some responses combine them; split defensively.
    const title: string = data.title ?? "Unknown";
    const artist: string = data.author_name ?? "Unknown artist";
    return { title, artist, thumbnail_url: data.thumbnail_url ?? null };
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
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PeakFeedBot/0.1)" },
    });
    const html = (await res.text()).slice(0, 50_000); // cap what we read
    const grab = (re: RegExp) => html.match(re)?.[1]?.trim() ?? null;
    return {
      finalUrl: res.url || url,
      title: grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
        grab(/<title>([^<]+)<\/title>/i),
      description: grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
        grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
      image: grab(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
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
  // A resolved short link might reveal a Google place id we couldn't see before.
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
  "title": string,          // song title, restaurant/venue name, movie title, etc
  "subtitle": string | null, // artist for songs, city/neighborhood for places, year for movies
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

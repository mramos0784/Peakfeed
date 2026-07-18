// Best-effort dedup key construction for Songs/Restaurants/Venues, used
// only when no real external id exists (no Spotify/Places API is wired up
// - see docs/file-map.md). Tagged with the "internal_key" provenance so
// it's visibly a PeakFeed-computed match, not a verified external id.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "-", mdash: "-", hellip: "...",
};

// Must run first, before anything else. Skipping this turns the kind of
// HTML-entity display bug seen elsewhere in this app into a silent dedup
// bug instead: "Don&#39;t Stop" and "Don't Stop" would normalize to
// different strings and never collapse into one entry.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => NAMED_ENTITIES[name] ?? `&${name};`);
}

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

// "(feat. X)", "(Remastered 2011)", "[Live]", "- Radio Edit", etc. - these
// vary release to release for what's musically the same song, and would
// otherwise stop two shares of the same track from deduping.
function stripBracketedSuffixes(s: string): string {
  return s
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, " ")
    .replace(
      /\s*-\s*(remaster(ed)?( \d{4})?|live|radio edit|explicit|clean|mono|stereo|deluxe( edition)?|bonus track|single version|album version)\b.*$/i,
      ""
    );
}

// Exact order matters: decode entities, then lowercase, then strip
// diacritics, then strip bracketed suffixes, then collapse whitespace/
// punctuation. Each step assumes the previous one already ran.
export function normalizeForDedup(raw: string): string {
  let s = decodeHtmlEntities(raw);
  s = s.toLowerCase();
  s = stripDiacritics(s);
  s = stripBracketedSuffixes(s);
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function songDedupKey(title: string, artist: string): string {
  return `${normalizeForDedup(title)}::${normalizeForDedup(artist)}`;
}

// City-level only, not exact address, not name alone - chain locations in
// the same city are expected to collapse into one entry; independent
// businesses sharing a name across different cities must not. There's no
// real geocoder available at dedup time (geocoding is async, happens after
// the entry already exists - see the jobs queue), so this is a lightweight
// heuristic: look for a known Tampa Bay area city name inside whatever
// location text we have, falling back to the raw text itself. The failure
// direction is safe either way - a miss just means two shares of the same
// place in the same city don't dedupe (no fabricated merge), never the
// reverse.
const TAMPA_BAY_CITIES = [
  "tampa", "st petersburg", "st pete", "saint petersburg", "clearwater",
  "brandon", "largo", "pinellas park", "dunedin", "palm harbor", "oldsmar",
  "temple terrace", "riverview", "wesley chapel", "land o lakes",
  "plant city", "ruskin", "seminole", "gulfport", "safety harbor",
  "tarpon springs", "new port richey", "lutz", "valrico", "apollo beach",
];

function extractCity(locationText: string): string {
  const normalized = normalizeForDedup(locationText);
  const match = TAMPA_BAY_CITIES.find((city) => normalized.includes(city));
  return match ?? normalized;
}

export function placeDedupKey(name: string, locationText: string): string {
  return `${normalizeForDedup(name)}::${extractCity(locationText)}`;
}

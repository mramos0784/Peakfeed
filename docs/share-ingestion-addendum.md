# PeakFeed — Architecture Addendum: Universal Share Ingestion & Multi-Destination Routing
*July 2026 · Confidential*

Replaces per-list share logic with a single ingestion function. Also sets the
honest boundary on what can and can't be identified automatically from a
shared link, including video.

## 1. The problem with per-list share logic
The prototype treats share handling as something each list type configures
separately. Doesn't scale, and doesn't match how a user actually shares — they
encounter one thing and share it once. The fix: a single ingestion function
that owns resolution and destination-matching, never asking the user to repeat
an action to reach a second list.

## 2. One share, one confirmation, multiple destinations
One share populating a system list and any relevant group lists at once is
correct. Doing it silently is not — a group list is a shared ballot, and an
item landing on it without the sharer choosing that breaks the self-moderation
model already established for groups.

**Resolution:**
- User shares a link once, from any platform
- The ingestion function resolves the content (tiers below) and determines
  its category
- Matches that category against every eligible destination: the relevant
  system list, plus any of the user's group lists tagged with that category
- One bottom sheet appears: the resolved item, a checkbox per eligible
  destination, pre-checked by confidence score. One tap confirms all of it.

Still a single share action from the user's side. What's rejected is invisible
fan-out, not multi-destination delivery.

**Dependency:** list creation needs a category tag (music, food, sneakers,
film, etc.) at the point a list is made. This doesn't exist in the current
Lists Architecture and needs to be added there, not just here.

## 3. Updated resolution tiers
The existing four-tier model holds, with one tier added above the raw-scrape
fallback — most short-form video/audio platforms expose oEmbed, a standardized
metadata endpoint, before a page scrape or LLM call is needed.

| Tier | Method | Covers | Cost |
|---|---|---|---|
| 1 | Direct API | Spotify, TMDB, Open Library, Google Places | Free/near-free |
| 1b (new) | oEmbed | YouTube, TikTok, SoundCloud, X — title, author, sound/track name, no scraping | Free |
| 2 | Pattern matching | URL structure, fuzzy dedup, handle matching | Free, runs locally |
| 3 | Vision API | Photographed flyers, product images | ~$0.0015/image |
| 4 | LLM fallback | OG-metadata pages with no clean ID, messy titles | Per-call, infrequent |
| Floor | Manual entry | Anything the above can't resolve | n/a — always available |

## 4. Video: what's actually possible
Claude cannot watch video. Frame-sampling to compensate is expensive and
unreliable and isn't a real solution here. The correct scope is narrower and
more honest: most identifiable video shares carry the identifying information
as data the platform already exposes, not as pixels to interpret.

**Resolves without watching anything:**
- oEmbed response — title, creator, often the attributed sound/track
- Caption text and sound-attribution fields, where the platform stores them
  separately from the video itself

**Does not resolve:** a video with no caption, no sound title, and nothing
usable in oEmbed. No reliable way to identify that content without a paid
audio-fingerprinting service (ACRCloud, AudD) — a real cost/integration
decision, not something this addendum resolves. That case lands on manual
entry, permanently, unless fingerprinting is added later as its own line item.
This is a boundary of the platform landscape, not a gap in the build.

## 5. Data model additions
Each ingested entry needs to carry more than the resolved item:
- **Source link** — stored as submitted, for provenance and future
  re-resolution if a platform's metadata improves
- **Resolution tier** — which tier produced the match, for debugging and
  tuning confidence thresholds over time
- **Confidence score** — drives which destination checkboxes are pre-checked
  in the confirmation sheet
- **Category tag** — matched against list category tags to build the
  destination list (see section 2)

## 6. What this doesn't solve
- Silent, zero-tap sharing to multiple lists is not being built. The
  confirmation step stays, just consolidated into one action instead of several.
- Fingerprint-free video with no metadata stays unresolved. This addendum does
  not commit to audio fingerprinting, only flags it as the sole real path if
  that gap needs closing later.
- Amazon Music remains without a clean Tier 1 path until an OAuth integration
  exists, consistent with the existing "noted for future development" entry.
  oEmbed does not cover it.

# PeakFeed — Changelog

Running log of what shipped, in plain terms. Newest first.

## 2026-07-20 — In-list search: structured forms, Creator handle match, Events fields, Issues tags

See `docs/adr/0008-in-list-search.md` for full reasoning and live-test
notes, including a real bug found and fixed mid-build.

- New `InListSearchForm.tsx`, rendered per-list in `ListBoard.tsx`,
  distinct from `AddToListsButton`'s global "+" flow. Named fields per
  category instead of one free-text box: Title/Artist (Songs), Name/City
  (Restaurants/Venues, City pre-filled from `profiles.city`), Title
  (Movies), Name/Location/Date (Events), Handle (Creators), Section tag +
  issue name (Issues).
- Songs and Restaurants/Venues save directly on submit (internal-key
  dedup, no live catalog to search) — confirmed this was already how
  `/api/entries` behaved before building the form around it.
- `src/lib/wikidataSearch.ts`: `searchWikidataByHandle()` — the
  P2002/P2003/P7085/P2397 exact handle-property SPARQL match for Creators,
  previously only documented, never implemented. First version used
  `FILTER(LCASE(...))` for case-insensitivity and timed out (502) on every
  real query against `query.wikidata.org` — verified live, fixed by
  matching a `VALUES` list of case variants directly in the triple pattern
  instead, which stays indexed.
- `src/lib/parseLink.ts`'s `webSearchCandidates()` grew an optional
  `{location, date}` param, used only for Events' web-search prompt —
  Wikidata's fuzzy search has no location/date filter, so only Name feeds
  that source; Location/Date are explicitly framed to the model as
  disambiguating, not a strict filter.
- Issues' closed-dropdown section tag (Politics/World/Local/.../Other,
  with a required free-text field when "Other" is picked) now persists to
  `entries.attributes` as two separate keys (`section_tag`,
  `section_other_text`) — reused the existing `attributes` jsonb column
  rather than adding new ones, since it already existed for exactly this
  kind of descriptive field and had never been written to.
- Live-tested all six category behaviors end-to-end against a real
  signed-in session (throwaway test account, cleaned up after) — see the
  ADR for the full results, including the Creator-search bug found this
  way.

## 2026-07-18 — Map screen visual pass

Follow-up polish on the Map screen from ADR 0007, prompted by the stock
Leaflet/OSM look reading as too visually busy against the brand palette.

- Swapped the tile layer from stock OpenStreetMap raster tiles to CARTO's
  free "Positron" basemap (`src/components/MapView.tsx`) — same underlying
  OSM data, muted grey/cream rendering instead of full-color roads/labels,
  so brand-colored pins read clearly instead of competing with the tiles.
  Free/keyless at this volume; attribution now credits both OpenStreetMap
  (data) and CARTO (tile rendering).
- Restyled Leaflet's default chrome to match the brand palette instead of
  library defaults: zoom control moved to bottom-right with a branded
  shadow/radius, attribution strip, and popups (Bebas Neue title, DM Sans
  body) — all in `globals.css` under `.leaflet-*` overrides plus new
  `.pf-map-*` classes. Markers shrunk slightly (14px → 11px) and given a
  softer shadow, filter chips now sit on `--mist-light` instead of plain
  white to match the rest of the app shell.
- No schema, API, or data-flow changes — display-only.

## 2026-07-18 — Dedup identifiers, job queue, geocoding, real Map screen

See `docs/adr/0007-dedup-geocoding-map.md` for full reasoning, the job
table schema, and the confirmed Nominatim rate-limiting mechanism.

- Two real platform constraints verified before building, not assumed:
  Vercel Cron only supports daily schedules on the Hobby plan (confirmed
  with the founder); Nominatim's actual limit for a recurring script is
  4 requests/minute, stricter than the 1/sec figure initially described.
- `src/lib/normalize.ts`: dedup keys for Songs (`title::artist`) and
  Restaurants/Venues (`name::city`, city-level via a Tampa Bay heuristic,
  never exact address). Entity-decoding runs first, before lowercasing —
  order matters, or the earlier HTML-entity display bug becomes a silent
  dedup bug instead. Wired into `/api/entries` as a fallback only when no
  real external id exists, tagged with a new `internal_key` provenance
  value (the seventh, added to `resolution_provenance`).
- New generic `jobs` table (`src/lib/jobs.ts`) — not geocoding-specific,
  reusable by the still-unbuilt async Wikidata enrichment job later.
  Atomic per-row claiming (no separate lock needed). New `geocode_cache`
  table, required by Nominatim's own usage policy and what keeps repeat
  lookups from spending budget twice.
- New `src/lib/supabase/admin.ts` (service-role client, cron-only, bypasses
  RLS) and `src/lib/nominatim.ts` (cache-first geocoding, proper custom
  User-Agent). New `/api/cron/geocode` route, paced to Nominatim's real
  4/min limit via explicit sequential sleeps around real requests only
  (cache hits are free and unpaced). New `SUPABASE_SERVICE_ROLE_KEY` and
  `CRON_SECRET` env vars required, neither exists yet.
- `entries.latitude`/`longitude` added — null until resolved, stays
  permanently null if Nominatim confirms no match, no coarser fallback
  ever. Entry creation never blocks on geocoding.
- Real Map screen built (roadmap item 5, previously `ComingSoon`) —
  vanilla Leaflet (not `react-leaflet`, sidesteps any React 19 compat
  question), real pins only for resolved coordinates, OSM attribution via
  Leaflet's standard tile-layer mechanism, category filter, tap-for-popup.
  Reasonably scoped, not the full `master-product-data.md` spec — no
  bounding-box live re-aggregation, subscribed-lists dropdown, vote-day
  strip, or action sheet. Confirmed with the founder as in-scope for this
  change before building it.

## 2026-07-17 — schema.sql migration bug fix (found running it live)

The founder ran the updated `schema.sql` in the Supabase SQL editor and hit
`type "entry_type" already exists` on the very first statement — the
original `entry_type` creation (pre-dating this session) was never wrapped
in the idempotent-creation pattern used for this session's newer
`resolution_provenance` type, so re-running the full file from top to
bottom errored out before ever reaching any of the actual new migrations
below it. Fixed by wrapping it in the same `DO $$ ... EXCEPTION WHEN
duplicate_object THEN NULL; END $$;` block. My mistake — I applied the
safe pattern to what I added but didn't check whether an older statement
in the same file needed it too.

**Second bug found running it live, same session:** past that point, hit
`unsafe use of new value "x_creator" of enum type entry_type` (Postgres
55P04) on the Creator-lists insert. `ALTER TYPE ... ADD VALUE` requires the
new value to be committed before use elsewhere in the same transaction,
and Supabase's SQL editor runs a pasted script as one implicit transaction
— so the four Creator enum values (added via `ALTER TYPE ADD VALUE` to the
already-existing `entry_type`) weren't usable yet by the time the insert
using them ran, further down the same script. Doesn't affect `entry_type`'s
original seven values or `resolution_provenance`'s values — both come from
a single `CREATE TYPE` statement, which has no such restriction. Fixed
with an explicit `COMMIT;` right after the four `ALTER TYPE ADD VALUE`
lines, closing that transaction boundary before anything downstream tries
to use the new values.

## 2026-07-17 — Multi-source search: Wikidata + web search, simultaneous

See `docs/adr/0006-multi-source-search.md`. Note: the founder referenced
"section 7" of `api-integrations-addendum.md` for this spec, but the file
has no section 7 (goes 1/2/3/5/6, then an unlabeled table) and doesn't
contain this two-pattern design anywhere — proceeded on the founder's
message as authoritative, flagged rather than guessed at silently.

- New: typed-text search for Films/Events/Issues/Creators now fires
  Wikidata search and a generalized web search simultaneously, no gate —
  each source populates its own section of a new results list the moment
  it responds. Songs/Restaurants/Venues are unchanged (no structured
  category API exists yet for either — Spotify Search and Google Places
  Search both need real credentials not yet provisioned, confirmed with
  the founder to defer).
- `src/lib/wikidataSearch.ts`: `searchWikidata()` via `wbsearchentities`,
  verified live and free/keyless before building. Scoped to Films/Events/
  Issues — Creator matching needs an exact handle-property SPARQL match
  per the addendum, a different mechanism not built this pass.
- `src/lib/parseLink.ts`: new `webSearchCandidates()`, distinct from the
  existing `webSearchExtractEvent` — enumerates up to 5 candidates for an
  ambiguous typed query instead of converging on one answer.
- New `/api/search/wikidata` and `/api/search/web` routes, called in
  parallel from the client (two ordinary fetches, no streaming
  infrastructure) so a slow source never blocks a fast one.
- `AddToListsButton.tsx` reworked around a unified `PendingEntry` shape so
  the confirm step works identically whether it came from a single-link
  resolution or a selected search candidate. Soft-bias sort (list-context
  matches first, nothing excluded). Every result shows a category badge
  and a provenance badge.
- **Closes the ADR 0005 gap**: `entries.provenance` now actually gets
  written. `/api/parse-link` maps every resolution's internal `source` to
  a persisted `provenance` value; `/api/entries` saves it — covers this
  new search path and the pre-existing single-link-resolve path in the
  same change.

## 2026-07-17 — Provenance/attributes schema, four Creator lists

See `docs/adr/0005-provenance-attributes-creator-lists.md`. Schema only,
per the founder's explicit scope for this session — nothing new writes to
these columns yet.

- Confirmed `lists.category` and the `issues` system list both already
  existed from an earlier session — nothing to add.
- New `resolution_provenance` enum on `entries` (`direct_api` / `url_id` /
  `wikidata_match` / `web_search` / `ai_guess` / `manual`) — six tiers
  instead of the addendum's three, confirmed with the founder, because
  three would have conflated `parseLink.ts`'s existing distinct resolution
  methods. Confidence is implied by tier, not a separate column.
- New dedicated `entries.attributes jsonb` column for Wikidata-sourced
  descriptive facts (genre, nationality, release year), kept separate from
  the existing `metadata` column — founder's choice over reusing
  `metadata`, since it already holds a different kind of thing (Events'
  operational date/sources data).
- Four new system lists — X Creator, TikTok Creator, Instagram Creator,
  YouTube Creator — each with its own `entry_type` enum value, since the
  dedup index and destination matching both key off type and the same
  handle can belong to different people on different platforms. Resolves
  the addendum's own flagged open decision: expands launch scope beyond
  the original five-list recommendation, on purpose.

## 2026-07-17 — Events resolve via web search, PeakFeed Event ID reduced

See `docs/adr/0004-events-web-search.md` for the full reasoning. Ticketmaster
and Eventbrite were both investigated and dropped (licensing ambiguity for
Ticketmaster, Eventbrite's public search API has been gone since 2020) —
see the prior changelog entries below for that research.

- `src/lib/parseLink.ts`: new `webSearchExtractEvent()` using Claude's real
  `web_search_20250305` tool (verified live, $10/1,000 searches + tokens,
  no separate key). Required upgrading `@anthropic-ai/sdk` 0.32.1 → 0.112.3.
  Source URLs are read from the API's own result blocks, never trusted from
  the model's JSON output. Confidence always forced to `"low"`.
- Typed-text resolution now exists for Events specifically (link or
  freeform description), gated to when the Add-to-Lists button was opened
  from the Events list — every other category is unchanged, still shows
  the "coming soon" message for typed input.
- PeakFeed Event ID reduced to `event:{date}:{normalized name}` — no venue
  Place ID (no live Google Places integration exists yet, for any
  category) and, after confirming with the founder, no submitting-user
  component in the dedup key itself (that would have prevented cross-user
  dedup entirely — provenance is tracked via `entries.created_by` and
  `list_items.added_by` instead, which already existed).
- New same-date fuzzy name-match dedup in `/api/entries` (`tokenOverlap()`,
  free/local, exported from `parseLink.ts`) runs before the exact
  `external_id` match — this is what makes "multiple sources collapse into
  one Event ID" actually true, since two different sources rarely phrase
  an event's title identically. No schema or RLS change needed.
- Found sources persist to `entries.metadata` (existing jsonb column, no
  migration). Not surfaced in any UI yet — "See sources" doesn't exist
  anywhere in the real app; storing now, building that view is separate,
  confirmed scope.
- **Bug found and fixed during live verification:** `max_tokens: 1024` was
  silently truncating the model's response before it reached the final
  JSON on every real multi-search query, always falling back to an empty
  title even when strong evidence was found (confirmed via inspecting real
  API responses — genuine sources every time, just no title). Raised to
  4096 (matches Anthropic's own multi-search example) and prompt now
  decouples "is this a real event" from "what's the exact date," so date
  ambiguity alone doesn't blank the title too. Retested clean after the
  fix. See the ADR for the full root-cause writeup. The fuzzy dedup path
  itself was verified by code review and build/lint only, not a live
  two-submission collapse test — flagged as worth checking before this is
  in front of real users.

## 2026-07-17 — TMDB integration removed (paid commercial license required)

Shipped earlier the same day, reverted the same day. TMDB's API requires a
paid commercial license for this kind of use — not caught before building
against it. Removed entirely from `src/lib/parseLink.ts` (both resolution
functions, the TMDB/IMDb URL detectors, the `tmdb` source type) rather than
left disabled behind a missing key. `TMDB_API_KEY` removed from
`.env.example`. TMDB/IMDb links are back to the generic AI/meta-scrape
fallback, same as before this feature existed. A non-commercial replacement
is planned; see the update note in `docs/adr/0003-global-add-button.md`.

## 2026-07-17 — Persistent "Add to Lists" button (Stage A)

See `docs/adr/0003-global-add-button.md` for the full reasoning, including
what's deliberately deferred.

- New floating "+" button on Map, the Lists index, and every individual
  list page — a global add entry point, separate from the per-list add box
  (which stays in place until this one is confirmed working).
- Paste-link flow reuses the existing `parseLink.ts` resolution unchanged.
  Typed free text shows "Paste a link for now — typed search is coming
  soon" instead of a fake search UI — no live-search integrations were
  built this session.
- Confirmation sheet offers the one real destination available today (the
  matching system list), built as a generic checkbox list so it doesn't
  need rebuilding once group lists exist.
- `lists.category` column added to the schema (unused today, unblocks the
  group-lists work later) plus `Issues` as a sixth system list — needs the
  founder to run the updated `schema.sql` in the Supabase SQL editor.
- `parseLink.ts`: `share.google` and Amazon Music links now short-circuit
  with a clear "can't auto-detect this" message instead of attempting (and
  failing) the normal resolution tiers. A generalized low-information-title
  guard now filters bot-block/interstitial titles ("Just a moment", "Sign
  in", generic short chrome-only titles) before they'd otherwise be shown
  as a pre-filled guess — applied to the Spotify scrape, the generic page
  scrape, and the AI's own returned title.
- **Open finding:** no TMDB/IMDb resolution tier exists — those links fall
  through to the generic AI/meta-scrape fallback with no real IMDB-ID
  extraction. Flagged, not fixed, this session; see the ADR.
- **Tested live, per the founder's request, before touching any other
  category:** a real TMDB link (`themoviedb.org/movie/27205-inception`)
  resolves via the fallback, correctly extracts "Inception" as the title
  (confirms the low-info-title guard doesn't wrongly reject short real
  titles), saves cleanly to Movies — but with `external_id: null`, so a
  second share of the same movie today would create a duplicate entry
  rather than deduping. A real IMDb link
  (`imdb.com/title/tt0133093`, The Matrix) does not resolve at all: IMDb
  returns `202 Accepted` with an empty body to the server's crawler
  User-Agent, so there's nothing to scrape. Confirmed this is IMDb's own
  bot-blocking, not a false-positive in the new title guard — the flow
  correctly falls back to a blank, manual-entry state rather than showing a
  fake guess, which is the intended behavior when nothing usable comes
  back. Both gaps have the same real fix: a proper TMDB API Tier-1
  integration (API key, official search/lookup endpoints, returns real
  IMDB IDs) would sidestep scraping imdb.com entirely and give Movies a
  clean dedup identifier. Not built this session — reported back per the
  founder's request, decision on whether to build it now is theirs.

## 2026-07-17 — Embedded prototype skips its own join screen

The interactive prototype embedded on the waitlist homepage now boots
straight into the Map screen instead of showing its own onboarding/join
form first — no visitor should face two "join" prompts back to back. See
the update note in `docs/adr/0002-waitlist-homepage.md`. Internal deep
links back to that screen (Profile → Account → "Join the waitlist") still
work; only the first-load behavior changed.

## 2026-07-17 — Waitlist homepage at `/`

See `docs/adr/0002-waitlist-homepage.md` for the reasoning.

- `/` now branches on auth state instead of always redirecting: logged-in
  users still redirect to `/lists` (unchanged), logged-out visitors get a
  waitlist homepage — wordmark/tagline, a 4-step how-it-works strip, a
  one-line description, a live embed of the interactive prototype, and a
  waitlist form.
- Moved `reference/peakfeed_v2.html` to `public/reference/peakfeed_v2.html`
  so it's servable for the iframe embed — same URL path, different disk
  location.
- New `/api/waitlist` route: validates name/email/city/interests and
  forwards to a Google Apps Script Web App via the server-only
  `WAITLIST_SCRIPT_URL` env var (documented in `.env.example`, needs to be
  set in both `.env.local` and the Vercel dashboard). Real errors surface
  to the form, nothing fails silently.
- `WaitlistForm` component: three interest checkboxes (not radio buttons —
  multi-select), submit disabled until at least one is checked.
- Small "Log in" link added to the waitlist hero so there's a way back into
  the app without typing `/login` directly.

## 2026-07-17 — Persistent nav shell (ROADMAP item 1)

Added the five-tab nav (Map / Lists / Vote Day / Feed / Profile) that
everything else attaches to. See `docs/adr/0001-persistent-nav-shell.md`
for the reasoning.

- New `(app)` route group with one shared layout: single auth check
  (replaces three duplicated `getUser()`/redirect checks), persistent
  rust header + bottom nav bar matching `peakfeed_v2.html`'s tokens.
- `lists/page.tsx` and `lists/[slug]/page.tsx` moved under `(app)/`, no
  functional changes — still real, still backed by Supabase.
- Map, Vote Day, Feed: honest "coming soon" placeholders (roadmap items
  5, 2, 3 respectively) — no fake data, no stubbed interactions.
- Profile: real page, not a placeholder. Shows username/city/join date
  from the `profiles` table and the signed-in user's 20 most recent
  votes. Sign-out moved here from the old Lists page.
- Vote Day tab shows a pulsing live dot during "vote weekend" (Friday
  8pm ET through Sunday), computed from real date math against the rule
  in `master-product-data.md` — no vote-cycle/lock table exists yet to
  drive this from real state.
- Added `.claude/launch.json` so the dev server can be previewed.

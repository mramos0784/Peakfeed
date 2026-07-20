# PeakFeed — File Map

Living document, update whenever routes/components/lib files are added or
moved. Not a full repo listing — just what a developer needs to orient.

## Routes (`src/app`)

| Path | File | Auth | Notes |
|---|---|---|---|
| `/` | `page.tsx` | — | Logged in: redirects to `/lists`. Logged out: waitlist homepage (wordmark, 4-step strip, prototype iframe, `WaitlistForm`) |
| `/login` | `login/page.tsx` | none | Standalone, no nav shell |
| `/signup` | `signup/page.tsx` | none | Standalone, no nav shell |
| `/map` | `(app)/map/page.tsx` | required | Real (ADR 0007) — fetches Restaurant/Venue/Event entries with resolved coordinates, renders `MapView` (Leaflet). Reasonably scoped, not the full master-doc spec. Also renders `AddToListsButton` |
| `/lists` | `(app)/lists/page.tsx` | required | Real: lists the system lists from the `lists` table. Also renders `AddToListsButton` |
| `/lists/[slug]` | `(app)/lists/[slug]/page.tsx` | required | Real: fetches list + items + votes, renders `ListBoard` + `AddToListsButton` (with list context) |
| `/vote-day` | `(app)/vote-day/page.tsx` | required | `ComingSoon` placeholder — roadmap item 2, needs a vote-cycle/lock table |
| `/feed` | `(app)/feed/page.tsx` | required | `ComingSoon` placeholder — roadmap item 3, needs a follow/activity model |
| `/profile` | `(app)/profile/page.tsx` | required | Real: username/city/join date from `profiles`, recent votes from `votes` (full entry shape since ADR 0009, renders `EntryActionMenu` per row) |
| `(app)/layout.tsx` | — | enforces auth | Shared layout for all 5 tabs — single auth check, renders `AppShell` |

`(app)` is a Next.js route group: it doesn't appear in the URL, it just
lets the 5 authenticated tabs share one layout without `/login` and
`/signup` inheriting it.

## API routes (`src/app/api`)

| Path | Purpose |
|---|---|
| `api/auth/signout` | POST, signs out and redirects to `/login` |
| `api/entries` | POST, creates an `entries` row + `list_items` row after a parsed link/search result is confirmed. Accepts `sectionTag`/`sectionOtherText` (Issues only, ADR 0008) and writes them to `entries.attributes`. Accepts `entryId` (ADR 0009, the universal action menu's "Add to list") to skip resolution entirely and attach a known entry straight to a list |
| `api/reports` | POST `{entryId, reason?}` (ADR 0009), inserts into `reports` — the universal action menu's "Report" action. Storage only, no read/triage surface yet (`reports` has no select policy for anyone, see `docs/prelaunch-checklist.md`) |
| `api/list-items` | DELETE `{listItemId}` (ADR 0010), the Lists screen's delete action — removes a `list_items` row only (this entry's membership in this specific list), never `entries`. RLS (`auth.uid() = added_by`) is the real enforcement; a wrong or unauthorized id just no-ops rather than erroring |
| `api/parse-link` | POST, resolves a pasted URL (or, Events only, a typed description) via `src/lib/parseLink.ts`. Response includes `provenance`, mapped server-side from the resolution's internal `source` |
| `api/search/wikidata` | POST `{query, category}`, branches (ADR 0008) between fuzzy name search (`searchWikidata`, Films/Events/Issues) and exact handle-property SPARQL match (`searchWikidataByHandle`, the four Creator types) via `src/lib/wikidataSearch.ts` — returns `{candidates: []}` for any other category |
| `api/search/web` | POST `{query, category, location?, date?}`, multi-candidate web search via `parseLink.ts`'s `webSearchCandidates()` — up to 5 results, not converged to one answer. `location`/`date` (Events' in-list search only, ADR 0008) enrich the prompt, used to disambiguate recurring event names |
| `api/cron/geocode` | GET, `CRON_SECRET`-gated. Vercel Cron trigger (`vercel.json`, once daily on Hobby). Claims pending `geocode` jobs, paced to Nominatim's real 4-req/min limit, writes `entries.latitude/longitude` |
| `api/vote` | POST, writes the signed-in user's ranked order to `votes` for the current week |
| `api/waitlist` | POST, no auth. Validates name/email/city/interests, forwards to the Google Apps Script Web App at `WAITLIST_SCRIPT_URL` (server-only env var, never sent to the client) |

## Components (`src/components`)

| File | Purpose |
|---|---|
| `AddToListsButton.tsx` | Client component: persistent floating "+" button (Map, Lists index, list detail pages) opening the global add flow. Paste-link works for every category; typed text triggers simultaneous Wikidata + web search for Films/Events/Issues/Creators (ADR 0006), still "coming soon" for Songs/Restaurants/Venues. Selection and single-link resolution both funnel into one unified confirm step |
| `AppShell.tsx` | Client component: persistent rust header + bottom nav bar, active-tab highlighting, live dot on Vote Day during vote weekend |
| `ComingSoon.tsx` | Shared placeholder for nav tabs with no backend yet (Map, Vote Day, Feed) |
| `ListBoard.tsx` | Client component: the actual Lists-screen functionality — paste-link parse/confirm, two-zone personal ranking (top ten / trailing queue, drag-and-drop plus arrow/promote/demote button alternatives, ADR 0010), explicit-Submit vote write (no live-on-reorder, no Friday lock), delete (list_items only, added_by-scoped), community ranking display. Per-list add box, kept in parallel with `AddToListsButton` until that's confirmed working. Renders `InListSearchForm` below the link box |
| `InListSearchForm.tsx` | Client component: structured, named-field in-list search (ADR 0008) — distinct from `AddToListsButton`'s single free-text box. Category fixed by the list it's rendered in: Songs/Restaurants/Venues save directly (internal-key dedup, no candidates); Movies/Events/Creators/Issues search Wikidata + web in parallel and show a confirm step |
| `MapView.tsx` | Client component: vanilla Leaflet map (not `react-leaflet`), pins only for entries with resolved coordinates, OSM attribution via the tile layer's standard mechanism, category filter, tap-for-popup (ADR 0007). Popup carries an "Actions" button (ADR 0009) wired via a `window.__pfMapAction` handler, since Leaflet's popup content is raw HTML, not a React child — opens `EntryActionMenu` in controlled (`hideTrigger`) mode |
| `EntryActionMenu.tsx` | Client component (ADR 0009): the universal action menu — Add to list / Open in / See sources / Share / Report, same fixed order everywhere an entry renders (`ListBoard`, `MapView`'s popup, `profile/page.tsx`'s recent votes). Self-triggering (own "⋯" button) by default, or controlled via `hideTrigger`+`open`+`onClose` for surfaces where the trigger can't live in this component's own React tree |
| `WaitlistForm.tsx` | Client component: name/email/city + interest checkboxes, posts to `/api/waitlist`, surfaces real errors, disabled submit until ≥1 checkbox is checked |

## Lib (`src/lib`)

| File | Purpose |
|---|---|
| `supabase/client.ts` | Browser-side Supabase client (anon key, RLS-gated) |
| `supabase/server.ts` | Server-side Supabase client (Server Components/Route Handlers, cookie-backed session) |
| `parseLink.ts` | Share-ingestion resolution: pattern-matches Spotify/Google Maps URLs first, escalates to the Anthropic API server-side only when no clean pattern matches. Short-circuits known-unsupported sources (Amazon Music, share.google) and filters bot-block/interstitial titles before they'd otherwise be presented as a guess. Also exports `webSearchCandidates()` (multi-result search, distinct from the single-answer `webSearchExtractEvent`) and `sourceToProvenance()` (maps internal resolution `source` to the persisted `ResolutionProvenance` enum) |
| `wikidataSearch.ts` | `searchWikidata()` — fuzzy name search via Wikidata's `wbsearchentities` action, free/keyless. Films/Events/Issues only. `searchWikidataByHandle()` (ADR 0008) — exact handle-property match (P2002/P2003/P7085/P2397) via the SPARQL query service for the four Creator types; matches against a `VALUES` list of case variants directly in the triple pattern, not a `FILTER(LCASE(...))` scan (verified live: the filter approach times out with a 502) |
| `systemLists.ts` | `getSystemLists()` — the live system-list set from the `lists` table, shared by `AddToListsButton` and the Lists pages instead of each querying it separately |
| `voteWeek.ts` | `currentWeekOf()` — which Monday a vote counts toward. `isVoteWeekend()` — real date math (America/New_York) for the Friday-8pm-through-Sunday window the nav's live dot uses |
| `normalize.ts` | Dedup key construction for Songs/Restaurants/Venues when no real external id exists — `songDedupKey()`, `placeDedupKey()` (city-level via a Tampa Bay heuristic). Entity-decode → lowercase → strip diacritics → strip bracketed suffixes → collapse whitespace, in that order (ADR 0007) |
| `jobs.ts` | Generic background job queue — `enqueueJob()`, `claimNextJobs()` (atomic per-row), `completeJob()`, `failJob()` (exponential backoff, permanent failure after `max_attempts`). Not geocoding-specific — reusable by the still-unbuilt async Wikidata enrichment job |
| `nominatim.ts` | `geocode()` — cache-first (required by Nominatim's usage policy), real custom User-Agent, distinguishes a confirmed negative (cached, not retried) from a transient error (retried with backoff) |
| `supabase/admin.ts` | Service-role Supabase client (bypasses RLS) — cron/background use only, never import into a user-facing route. Requires `SUPABASE_SERVICE_ROLE_KEY` |

## Root

| File | Purpose |
|---|---|
| `src/proxy.ts` | Next.js middleware, keeps the Supabase session cookie fresh on every request (does not gate routes — auth gating lives in `(app)/layout.tsx`) |
| `src/app/layout.tsx` | Root HTML shell: Bebas Neue + DM Sans fonts, Tabler icons webfont (used by `AppShell`'s nav icons) |
| `src/app/globals.css` | Brand color tokens (rust/slate/olive/sage/mist) + `pf-*` classes for the nav shell, `wl-*` classes for the waitlist homepage |
| `supabase/schema.sql` | Full DB schema, version-controlled — `profiles`, `entries` (`provenance` [`resolution_provenance` enum, now 7 values with `internal_key`], `attributes` jsonb [Issues' `section_tag`/`section_other_text` since ADR 0008, otherwise unpopulated], `metadata`, `latitude`/`longitude` [null until geocoded, ADR 0007]), `lists` (`category` column, unused; ten system lists), `list_items` (delete policy since ADR 0010, scoped to `added_by`), `votes`, `jobs` (generic queue), `geocode_cache`, `reports` (ADR 0009 — `entry_id`/`reporter_id`/`reason`, `jobs`-pattern RLS: insert scoped to the acting user, no select policy for anyone). Additive changes use `alter table/type ... add ... if not exists` (or a `duplicate_object`-catching `DO` block for `CREATE TYPE`, which has no native `IF NOT EXISTS`) so re-running the file against an existing database is safe |
| `public/reference/peakfeed_v2.html` | The static design prototype — moved here (from `reference/` at repo root) so the waitlist homepage can embed it in an iframe at `/reference/peakfeed_v2.html`. Still the CLAUDE.md-referenced visual target, just servable now. |
| `vercel.json` | Cron schedule for `/api/cron/geocode` — once daily (`0 6 * * *`), the Hobby plan's hard minimum interval. A one-line change to go more frequent on Pro |

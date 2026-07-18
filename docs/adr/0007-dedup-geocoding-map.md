# ADR 0007 — Dedup identifiers, job queue, geocoding, and the real Map screen

*2026-07-18*

## Context
Four pieces requested as one cohesive change: better dedup for Songs/
Restaurants/Venues (which have no direct-API identifier — see the last
status report), a generic background job queue (nothing like this existed
in the codebase), Nominatim-based coordinate resolution through that queue,
and the first real build of the Map screen (roadmap item 5, previously a
`ComingSoon` placeholder).

Two real platform constraints were verified before writing any code, the
same discipline as every other external-API decision this session:

- **Vercel Cron on the Hobby plan only supports daily schedules.** Sub-daily
  cron expressions fail to deploy entirely. Confirmed with the founder
  (Hobby) before choosing `vercel.json`'s schedule.
- **Nominatim's real limit for this use case is stricter than the founder's
  own description of it.** The 1 request/second figure is the *absolute*
  ceiling for any use; their policy separately states "scripts run at
  regular intervals are restricted to 4 requests per minute" — and a cron-
  driven geocoding queue is unambiguously that. Built to the stricter
  number (see "Rate-limiting approach" below), not the looser one.

## 1. Dedup identifiers
`songDedupKey()` / `placeDedupKey()` in `src/lib/normalize.ts`, applied in
`/api/entries` only when no real `external_id` already exists. Normalization
order, exactly as specified: decode HTML entities → lowercase → strip
diacritics → strip bracketed suffixes (`"(feat. X)"`, `"- Remastered 2011"`)
→ collapse whitespace/punctuation. Entity-decoding runs first and is
required, not optional — skipping it would turn an HTML-entity display bug
into a silent dedup bug (`"Don&#39;t Stop"` vs `"Don't Stop"` would
otherwise normalize to two different strings).

**City extraction for places is a heuristic, not a geocode.** No real
geocoder is available at dedup time — geocoding happens asynchronously,
after the entry already exists, which is the whole point of the job queue.
`placeDedupKey()` looks for a known Tampa Bay area city name inside
whatever location text is available, falling back to the raw text itself
if none matches. The failure direction is safe either way: a miss means two
shares of the same place don't dedupe (no fabricated merge), never the
reverse (an incorrect merge of two different places).

Tagged with a new `internal_key` provenance value — the seventh value on
`resolution_provenance`, added via `ALTER TYPE ... ADD VALUE` after the
original six. Visibly a PeakFeed-computed best-effort match, not anything
verified against an external source.

## 2. Generic job queue — schema, as requested
```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  entry_id uuid references entries(id) on delete cascade,
  status text not null default 'pending', -- pending | in_progress | done | failed
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_run_at timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claimable_idx on jobs (job_type, status, next_run_at)
  where status = 'pending';
```
Deliberately generic — `job_type` is what makes this reusable rather than a
one-off. The async Wikidata enrichment job `api-integrations-addendum.md`
describes (and this codebase never built, per the last status report) is
the same shape of problem — "do slow/rate-limited work after an entry
already exists, without blocking creation" — and can use `job_type =
'wikidata_enrich'` on this same table later instead of a second queue.

**Claiming is atomic per-row, not via a separate global lock.**
`claimNextJobs()` in `src/lib/jobs.ts` does `UPDATE jobs SET status =
'in_progress' WHERE id = X AND status = 'pending'` for each candidate row —
the `WHERE status = 'pending'` re-check at update time is what actually
prevents two overlapping workers from double-processing the same row (a
second claimer's UPDATE matches zero rows and is silently skipped), not a
separate locking mechanism. Sufficient given the deployment reality: Hobby
allows exactly one cron invocation per day, so concurrent-invocation risk
is low, but the atomic-claim guarantee holds regardless of schedule.

**RLS:** `jobs` and `geocode_cache` both have `enable row level security`
with no `select` policy for either — a signed-in user's own client sees
zero rows from both. Only the geocode cron route's service-role client
(`src/lib/supabase/admin.ts`, bypasses RLS entirely) reads or updates them.
The one exception: `jobs` has an `insert` policy for any signed-in user,
since `/api/entries` enqueues jobs using the requesting user's own session,
not a service-role client — enqueueing happens inside a normal user
request, processing does not.

**New required env vars, neither of which exist yet:** `SUPABASE_SERVICE_
ROLE_KEY` (from the Supabase project's Settings > API — the anon key
cannot bypass RLS, which the cron route needs to write `entries.latitude/
longitude` on behalf of no particular user) and `CRON_SECRET` (any string
the founder chooses, set identically in the Vercel dashboard, verified in
the route handler so only Vercel's own cron trigger can invoke it).

## 3. Rate-limiting approach, confirmed as requested
**Mechanism:** `geocode()` in `src/lib/nominatim.ts` checks `geocode_cache`
first (keyed by the normalized query string) — a cache hit never touches
Nominatim at all, so it's excluded from pacing entirely. On a cache miss,
the cron route (`src/app/api/cron/geocode/route.ts`) sleeps 16 seconds
*after* every real Nominatim request before processing the next claimed
job — 16s rather than the strict 15s minimum (60s / 4 requests) as a small
safety margin against clock imprecision. This is real, in-process
sequential pacing via `await sleep(16_000)`, not a comment promising care.

**Why in-process sequential pacing is sufficient here, not a DB-persisted
rate limiter:** Nominatim's policy additionally requires "a single thread...
limited to 1 machine only, no distributed scripts" — exactly what a single
Vercel function invocation processing jobs one at a time already is. A
cross-invocation, DB-persisted last-request timestamp would be the more
bulletproof mechanism, but isn't needed at the current one-invocation-per-
day cadence, and would be genuinely necessary if this ever moves to a more
frequent, potentially-overlapping Pro-plan schedule — flagged here so that
requirement isn't lost if the schedule changes later.

**Batch size:** 15 jobs per invocation. Vercel Hobby's function duration
default and maximum are both 300 seconds (verified before choosing this —
not the 10s figure from Vercel's older, pre-fluid-compute limits). 300s /
16s per real request ≈ 18 requests fit in the window; 15 leaves headroom
for actual DB round-trips and JSON parsing beyond just the sleep, not a
number derived from Nominatim's own limit directly.

**Custom User-Agent**, per their explicit "stock User-Agents as set by http
libraries will not do": `PeakFeedBot/0.1 (+https://peakfeed.app)`, reusing
the same identity already used elsewhere in `parseLink.ts`.

**Negative results are cached too** (`geocode_cache.resolved = false`) — a
confirmed-unfindable address is never re-queried by a later retry attempt,
only genuinely transient failures (network/HTTP errors, left uncached) get
retried with backoff.

## 4. Map display behavior
`entries.latitude`/`entries.longitude` are the only source of truth for
"does this show a pin" — both null means no pin, full stop, regardless of
*why* they're null (not yet processed, in progress, or permanently failed
after `max_attempts` — all three look identical to the Map screen, which
only ever queries `where latitude is not null`). No placeholder position,
no coarser fallback, ever. `jobs.status`/`jobs.attempts` carry the "pending
vs. permanently failed" distinction for debugging/admin purposes, which is
a different concern from what the map renders.

## 5. Map screen — built, but reasonably scoped, not the full master-doc spec
The founder chose to build the real Map screen as part of this change
(replacing the `ComingSoon` placeholder), not just the backend data layer.
Built: vanilla Leaflet (not `react-leaflet` — sidesteps any React 19
compatibility question entirely, and matches how the static prototype
itself already uses vanilla Leaflet) with a standard OpenStreetMap tile
layer, real pins only for entries with resolved coordinates, a simple
category filter (Restaurants/Venues/Events — the only three geocodable
types), and a tap-to-see-name/subtitle popup. OSM attribution is automatic
via Leaflet's own tile-layer `attribution` option, the standard mechanism —
not a manually-placed credit line.

**Deliberately not built**, since `master-product-data.md`'s full Map
spec is substantially larger than what this session's four sections
actually describe: the subscribed/suggested-lists dropdown with active-
voter counts, bounding-box live re-aggregation with debounce, the vote-day
notification strip, and the three-item action sheet (open externally/view
on PeakFeed/share). Building all of that was judged separate, much larger
scope than "coordinate resolution plus a map that shows the result" — this
is a real, working slice, not the complete roadmap item 5.

## Consequences
- The queue only drains 15 jobs/day on the Hobby plan. If more than 15
  Restaurant/Venue/Event entries get created in a single day, the backlog
  takes multiple days to fully resolve — an accepted, documented
  degradation, not a bug. Entries are visible in list views immediately
  regardless; only the map pin lags.
- `placeDedupKey()`'s city-heuristic list (`TAMPA_BAY_CITIES` in
  `normalize.ts`) is hardcoded and not exhaustive. A restaurant in a Tampa
  Bay city not on that list falls back to using the raw location text as
  its "city" component — still safe (under-dedupes rather than
  over-merges), just not as effective as it could be for that city
  specifically.
- The Map's category filter re-filters an already-fetched, complete set of
  geocoded entries client-side — there's no live bounding-box query. On a
  data set large enough that "every geocoded entry, every time" becomes
  slow to fetch, this would need revisiting; not a concern yet.
- `enqueueJob()` swallows its own errors (logs, doesn't throw) — a failed
  enqueue means an entry silently never gets a map pin rather than failing
  the entry's save. Worth monitoring server logs for `"enqueueJob failed"`
  if map pins seem to be missing more often than expected.

# ADR 0003 — Persistent "Add to Lists" button, staged to what's real today

*2026-07-17*

## Context
Every list's add flow lived only inside that list's own page (`ListBoard`'s
paste-link box). There was no way to add something without first navigating
into the specific list it belonged to. The founder asked for a persistent,
prominent global entry point — visible on Map and Lists, not nested inside
any one list — that opens the same kind of add flow from anywhere.

The full spec this button is meant to eventually support (per
`share-ingestion-addendum.md` and this session's brief) needs several things
that don't exist yet:
- A `category` column on `lists`, to match a share against eligible group
  lists.
- Group lists themselves — no membership table, no creation flow, nothing.
  Even with a category column, there's nothing to match against.
- Live search against Spotify/Google Places/TMDB/Open Library for typed
  free text, per category.
- An LLM-with-search fallback for Events and Issues specifically.

None of that exists. Faking any of it — mock search results, a stubbed
group-list checkbox that never has anything to check, a "smart" typed-text
flow with no real search behind it — would violate the project's standing
rule against stubbing functionality that isn't there.

## Decision
**Stage A only, this session: real, not full.** The button and its flow are
100% wired to what's actually built:
- Paste a link → the existing `parseLink.ts` resolution tiers, unchanged
  logic, just reachable from a new entry point.
- Type free text (not a link) → "Paste a link for now — typed search is
  coming soon." No fake search results, no broken input that looks live but
  isn't.
- Confirmation step offers exactly one destination: the system list whose
  `type` matches the resolved entry, when one exists. No group-list
  checkboxes are rendered, because there are never any group lists to offer
  — the multi-destination checkbox UI is still built generically (an array
  of destinations, not a hardcoded single list) so it doesn't need
  rebuilding once group lists exist, it just starts rendering more than one
  checkbox.

Live search (Spotify/Places/TMDB/Open Library) and the LLM-with-search
fallback for Events/Issues are explicitly deferred — real features on their
own, scoped separately once this lands, not built or stubbed here.

**Category column added now, unused.** `lists.category` went into
`supabase/schema.sql` this session even though nothing reads or writes it
yet — cheap, additive, and it's been sitting as a flagged dependency in
`open-decisions.md` since the share-ingestion addendum. Getting the column
in place now means the eventual group-lists work doesn't also have to be a
migration. Needs the founder to run the updated `schema.sql` in the Supabase
SQL editor — an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` isn't something
this session's tooling can execute against the live database directly.

**Issues added as the sixth system list**, closing the gap between the
schema (which only had five) and `lists-architecture.md`'s recommended
launch set (Songs, Restaurants, Venues, Events, Issues, plus Movies already
shipped ahead of that set). Same migration as the category column.

**Button placement: Map, Lists index, and every list detail page.** The
brief's own requirement — "if opened from a specific list's context, that
list should be pre-checked" — only makes sense on `/lists/[slug]`, where
list context actually exists. So the button lives in three places:
`(app)/map/page.tsx`, `(app)/lists/page.tsx`, and `(app)/lists/[slug]/page.tsx`,
each fetching the live system-list set via the new `getSystemLists()`
helper (`src/lib/systemLists.ts`) instead of a hardcoded list, so it can
never drift from what's actually seeded.

**List-context pre-checking, today's version.** Since exactly one system
list exists per entry type, "the current list is pre-checked" and "the
resolved item's matching system list is pre-checked" are the same list
whenever the current list's type matches what got resolved — there's no
second, distinct checkbox to show today. When they don't match (e.g.
pasting a song link while viewing the Restaurants list), only the correctly
matching system list is offered — the mismatched current list is not
force-included, consistent with category-based destination matching in the
addendum. `hintType` (the current list's type) is still passed into
`parseLink()` so an ambiguous link defaults toward the list the user was
already on when the type is genuinely unclear.

**Button is `position: fixed`, unlike the nav bar.** The nav bar
(`.pf-navbar`) is a normal flex item that scrolls away on pages taller than
the viewport (existing behavior from ADR 0001, unchanged here). "Persistent"
for this button means always reachable regardless of scroll position, so it
uses `position: fixed` and stays pinned to the viewport — an intentional,
visible inconsistency with the nav bar's current scroll behavior, not a bug.

## Two general-purpose fixes folded into `parseLink.ts` while building the
confirmation sheet from scratch
- **Unsupported-source short-circuit.** `share.google` (Google's Share-button
  URL shortener — wraps a search result/knowledge panel, no real page behind
  it) and Amazon Music (no Tier 1 path until an OAuth integration exists,
  per the addendum) now short-circuit before any network call, returning a
  `source: "unsupported"` result with a clear message instead of attempting
  — and failing at — the normal resolution tiers.
- **Generalized low-information-title guard.** Replaces the idea of
  matching specific known bot-block phrases one at a time (too narrow —
  new interstitial variants show up constantly) with two checks: an exact
  denylist for the common cases ("Just a moment", "Sign in", "Loading...",
  etc.), plus a check that only rejects a *short* (1-2 word) title if every
  word in it is generic interstitial vocabulary. Deliberately does not
  reject all short titles — real movie and song titles are frequently one
  or two words ("Up", "Jaws", "Barbie") and would be wrongly flagged by a
  blanket word-count rule. Applied at three points: the Spotify meta-tag
  scrape, the generic page-meta scrape, and the AI's own returned title
  (since Claude can only repeat back what a bad scrape gave it). When a
  title fails the check, the field is left blank and confidence is forced
  to `"low"` rather than falling back to a placeholder like `"Untitled"`
  that reads as a real answer.

## Open finding, not yet resolved
**No TMDB/IMDb resolution tier exists.** `lists-architecture.md` specifies
IMDB ID via the TMDB API as the clean identifier for Films — `parseLink.ts`
has never implemented that tier. A TMDB or IMDb link today falls straight
into the generic AI/meta-scrape fallback, same as any unrecognized link:
whatever `og:title`/`og:description` the page exposes, no real IMDB-ID
extraction, no dedup identifier. This is the same category of work as the
deferred live-search integrations (a new direct-API integration), not
something this session built. Tested and reported on separately — see the
changelog entry for what pasting a real TMDB/IMDb link actually does today.

## Consequences
- The per-list add box in `ListBoard.tsx` is untouched and still fully
  functional — this is a parallel entry point, not a replacement yet, per
  the founder's explicit instruction. Removing the old boxes is a follow-up
  once this one is confirmed working.
- `AddToListsButton`'s destination logic (`systemLists.find(l => l.type ===
  parsed.type)`) assumes at most one system list per type. If that ever
  becomes false, the `.find()` silently picks the first match — worth
  revisiting when/if that assumption changes.
- The schema migration (`category` column + `issues` list) needs to be run
  manually in Supabase before "Issues" appears as a real destination in the
  app. Until then, pasting something that resolves to `type: "issue"` will
  correctly show "No matching list for this yet" rather than erroring.

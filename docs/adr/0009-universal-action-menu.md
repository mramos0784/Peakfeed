# ADR 0009 — Universal action menu: Add to list / Open in / See sources / Share / Report

*2026-07-20*

## Context
`docs/api-integrations-addendum.md` section 6 specs a fixed-order action
menu (Add to list → Open in → See sources → Share) that every surface
showing an entry must carry, with no exceptions. Section on harmful links
(same doc) adds Report as a fifth action, reachable from the same menu,
storage-only for now — no review/triage workflow, tracked as a real launch
blocker in `docs/prelaunch-checklist.md`.

Before building, audited every screen that renders an entry (see the scope
report given inline this session, not repeated here) and found: **no
screen shares one entry-rendering component today.** `ListBoard.tsx` has
two separate inline loops (personal ranking, community ranking).
`MapView.tsx` renders via a Leaflet popup HTML string, not JSX at all.
`profile/page.tsx`'s recent-votes row only ever fetched `entry.title` —
no `id`, no `source_url`, nothing else. So this wasn't "add a menu to the
existing shared component" (none existed) — it was building the shared
component first, then retrofitting each of the three real screens
(`lists/page.tsx`, Feed, Vote Day render no entries at all — out of scope,
confirmed via the same audit).

## Decisions

**New `EntryActionMenu.tsx`, used everywhere, not duplicated per screen.**
Given the doc's own "no exceptions" framing, and given this codebase
already has a precedent for *not* doing this (`AddToListsButton.tsx` and
`InListSearchForm.tsx` each independently define their own near-identical
`CandidateRow`), this one was built once and imported into all three real
call sites from the start rather than repeating that pattern a third time.

**"Add to list" reuses the existing single-checkbox confirm pattern, not
`AddToListsButton`'s internals.** The addendum says to reuse "the existing
multi-destination confirmation sheet ... as-is." Since group lists don't
exist yet, that sheet is currently always a single checkbox (one system
list matches one entry type) — confirmed this is `AddToListsButton`'s
actual current behavior before building anything. Rather than importing
`AddToListsButton`'s tightly-coupled internal state machine, the menu
reimplements the same small pattern (one checkbox, pre-checked, "Add it"
button) — visually and behaviorally identical, no new destination logic
invented. When group lists ship, both places need the same
multi-checkbox upgrade; not deduplicating that yet was a deliberate
call, not an oversight — the two flows still start from different states
(no identifier yet vs. already-resolved) even after that upgrade.

**"Add to list" truly skips resolution — new `entryId` shortcut on
`/api/entries`.** The entry already has a real `entries.id`; re-running it
through title/subtitle dedup would be pointless and risks the fuzzy event
matcher or internal-key logic producing a different result than "the exact
row this menu was opened from." `/api/entries` now branches on
`body.entryId`: if present, skip the entire create-or-dedupe block and go
straight to the list_items upsert (factored into a shared `attachToList()`
helper used by both paths, so the upsert-then-fetch-existing-on-conflict
logic isn't duplicated).

**"Open in" reconstructs a link from whatever the resolution tier left
behind, in priority order:** the literal `source_url` if one was pasted,
else a URL built from the `external_id` prefix (`spotify:` →
open.spotify.com, `google_place:`/`google_ftid:` → Google Maps,
`wikidata:` → wikidata.org). `event:`/`internal:` prefixed ids are
PeakFeed's own dedup keys, not a real platform's — correctly yield no
link, "Open in" shows disabled rather than pretending a real destination
exists.

**"See sources" reads `entries.metadata.sources`** (Events' array of
`{url, title}`, populated since ADR 0004, never read by any UI until now)
**falling back to `source_url`** as a single source for every other
category, **falling back to "No sources available."** No new data
collection — this was already the addendum's spec, the array existed and
sat unused.

**Report is a fifth top-level menu item, not nested under "See sources."**
The addendum leaves this as an explicit "your call" between the two. A
top-level item is one tap instead of two, and doesn't overload "See
sources" (a read/browse action) with "Report" (a write/moderation action)
sharing one entry point — different intents, kept visually distinct.

**Report storage: new `reports` table, `jobs`-pattern RLS (insert-only, no
select for anyone).** `entry_id`, `reporter_id`, `reason` (nullable free
text), `created_at`. Insert policy scopes to `auth.uid() = reporter_id`
(mirrors `votes`/`list_items`, tighter than `jobs`'s `auth.uid() is not
null`, since a report is tied to its filer the same way a vote is).
Deliberately **no select policy at all**, including for the reporter's own
client — there's no "my reports" UI, and this is the first table where
even the acting user shouldn't be able to read their own row back; only a
future service-role moderation view will.

## Live-tested (real signed-in session, throwaway test account, cleaned up after)
- **ListBoard** (Songs list, both personal-ranking and community-ranking
  rows): menu opens in the documented order every time. "Add to list" on
  an already-listed Spotify song correctly showed "Songs" pre-checked and
  saved via the `entryId` shortcut (confirmed idempotent — the entry was
  already in that list, upsert no-op'd cleanly rather than erroring).
  "Open in" correctly read the real `source_url`
  (`open.spotify.com/track/...`, confirmed via direct query) and closed
  the menu (the actual new-tab `window.open` call didn't visibly open a
  tab in the automated browser sandbox — expected sandbox behavior, not a
  code issue, since the same `window.open` call is what "Share"'s
  clipboard-fallback code path also already used successfully elsewhere
  this session).
- **See sources**, Events list: "Gasparilla Music Festival" (real
  `metadata.sources`, 19 entries from the earlier in-list-search session)
  rendered all 19 as distinct clickable links. A different event with
  empty `sources: []` but a real `source_url` correctly fell back to
  showing that single link instead.
- **MapView popup**: clicking a pin's new "Actions" button (added via a
  window-level handler, since Leaflet's popup HTML can't hold a React
  child) opened the identical `EntryActionMenu`, confirmed the same
  menu order and "See sources" fallback behavior as ListBoard, from a
  structurally completely different rendering path.
- **Report**: submitting against a real entry correctly surfaced "Could
  not submit that. Try again." rather than crashing — confirmed via a
  direct `PGRST205` query (`Could not find the table 'public.reports'`)
  that this is purely the schema migration not yet applied to the live
  database (same standing pattern as ADR 0006's provenance/attributes
  columns — the founder runs `schema.sql` manually in the Supabase SQL
  editor, no direct-DB tooling exists in this environment). Error-handling
  path itself is confirmed correct; full success-path verification is
  blocked on that migration.

## Consequences
- `profile/page.tsx`'s votes query grew from selecting just `entry(title)`
  to the full entry shape (`id, type, title, subtitle, source_url,
  external_id, metadata`) needed for the menu to work there — a real
  widening of that page's data footprint, not just a UI change.
- `MapView`'s popup mechanism now depends on a single global
  `window.__pfMapAction` handler rather than being a self-contained
  Leaflet integration. Acceptable for one map instance (this app has
  exactly one), would need reworking (unique per-instance handler names,
  or a real portal-based popup renderer) if a second concurrent map view
  is ever added.
- Delete/remove-from-list was explicitly kept out of this menu per
  instruction — belongs with the drag-and-reorder build later, not bolted
  on here.
- `EntryActionMenu` and `AddToListsButton`/`InListSearchForm`'s confirm
  steps are now three independent places that each know how to render a
  single-checkbox list-destination picker. Flagged, not fixed — the
  "reuse as-is" instruction was interpreted at the pattern level, not as a
  mandate to refactor `AddToListsButton`'s internals this session.

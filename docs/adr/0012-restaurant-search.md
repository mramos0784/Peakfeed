# ADR 0012 — Restaurant and Venue search move off direct-create, onto web search

*2026-08-12*

## Context
Reported by the founder: adding a restaurant via `InListSearchForm.tsx`
"didn't seem to search... it just added what I typed." That's expected
behavior as coded, not a bug — ADR 0008 put Songs, Restaurants, and
Venues in `DIRECT_CREATE_TYPES` on purpose, since no live catalog existed
to search against for any of the three. `api-integrations-addendum.md`
section 8 already recorded *why* for Restaurants/Venues specifically:
real Google Places API integration was dropped in favor of a free
internal `normalize(name)::city` dedup key, "real external identifiers
can be layered in later once funding covers them."

Restaurants and Venues have always been treated identically in this
codebase (same dedup function `placeDedupKey`, same geocoding query
shape, same original Google Places plan) — the first pass of this ADR
fixed Restaurants only, scoped tightly to the reported bug. The founder
then asked to extend the same fix to Venues immediately after, same
session, so this ADR covers both rather than splitting into a near-
duplicate 0013.

Two ways to close the gap: wire real Google Places (matches the
originally-intended design, gives a verified Place ID, but needs a
Google Cloud Billing account and ongoing per-request cost), or extend
the free Wikidata + web-search flow ADR 0006/0008 already built for
Films/Events/Issues/Creators to Restaurants too. Founder chose the
second, explicitly asking whether it could still populate an address
usable by the map.

**It can, without needing a real address at all.** Map pin resolution
(ADR 0007) already geocodes off `${title}, ${subtitle}` — a business
name plus city — through free Nominatim/OpenStreetMap search, which
already indexes named POIs. This was true before this change too;
today's `DIRECT_CREATE_TYPES` restaurants get pinned the same way once a
user types a real name and city. What was missing wasn't map capability,
it was verifying the name/city came from a real search instead of
whatever the user happened to type, plus giving the user a source link
to check.

## Decisions

**Restaurant and Venue leave `DIRECT_CREATE_TYPES`, join the
search-and-confirm flow.** `InListSearchForm.tsx` gets one shared
`isPlace` query field (same shape as Movies, placeholder text swaps
between "Restaurant name" / "Venue name"), firing `/api/search/wikidata`
+ `/api/search/web` in parallel, same as every other search-backed
category. Neither is added to Wikidata's `FUZZY_CATEGORIES` — most local
restaurants and venues aren't notable enough for Wikidata to carry, so
that section will usually read "No matches," same as it already does
for other Wikidata-thin categories. Web search does the real work here,
same division of labor `api-integrations-addendum.md` section 7
describes for Films/Events/Issues/Creators. Song is now the only
`DIRECT_CREATE_TYPES` category left.

**`webSearchCandidates()` gets a shared restaurant/venue prompt
addition**: requires the place to look currently open (not confirmed
closed), and constrains `subtitle` to just city or "neighborhood, city"
— not a tagline, cuisine, or venue-type description — since that string
is exactly what `/api/entries` later feeds Nominatim for the map pin. A
generic subtitle from the shared prompt would have undermined the one
thing that needed to work reliably. If the search doesn't surface a
subtitle, `InListSearchForm.tsx` falls back to the user's own
`profiles.city` (already threaded through as `homeCity` since ADR 0008)
rather than leaving the field blank with nothing to geocode.

**`SearchCandidate` gains `source_url`, verified the same way Events'
`sources` list already is.** The model is asked to return a
`source_url` per candidate, copied from a real search result page, but
that string is never trusted as-is — every real result URL the API
actually returned is collected into a set (`web_search_tool_result`
blocks), and the model's claimed `source_url` is only kept if it
matches one of those. A fabricated-but-plausible URL becomes `null`,
never a saved source link. This is the same anti-hallucination pattern
`webSearchExtractEvent` already uses for its `sources` array, generalized
to the multi-candidate path. Wikidata candidates get a `source_url` too
now — the Wikidata item's own page, a legitimately real link, not
something requiring the same verification.

**Confirm step shows the verified source link** (when present) as a
read-only `<a>` under the City field — lets the user actually check the
match before saving, which the direct-create path never offered at all.

**Same change applied to `AddToListsButton.tsx`** (the global "+"
button), which had its own, separate `MULTI_SEARCH_CATEGORIES` list not
including Restaurant or Venue — typed search for either still said
"coming soon." Added both there too and wired `source_url` through
`selectCandidate`, so both search surfaces behave consistently instead
of one being fixed and the other silently left stale.

**Song stays direct-create, untouched.** Songs have no location
component at all, so this ADR's map-geocoding motivation doesn't apply
to them — a separate decision if/when Spotify Search gets wired in.

## Not live-tested
Unlike ADR 0008, this session had no signed-in browser session available
(Supabase auth requires the founder's own credentials, which weren't
enterable per this assistant's own operating rules) — `tsc --noEmit` and
`eslint` both pass clean, but the actual search-and-save flow hasn't been
clicked through end to end yet. Founder should verify: search a real
restaurant and a real venue, confirm the city/source populate correctly,
save them, and check they eventually get map pins via the geocode cron.

## Consequences
- Wikidata will near-always return "No matches" for restaurant and venue
  searches — expected, not a bug, flagged above so it isn't mistaken for
  one later.
- Restaurant/Venue dedup is still the internal `normalize(name)::city`
  key (ADR 0007), not a verified Place ID — a real chain location in the
  same city still collapses correctly, but this doesn't newly enable
  anything Google Places would have (e.g. confirming two differently-
  named listings are the same physical place).
- Nominatim's business-name search is decent but not guaranteed —
  a real, currently-open place can still fail to geocode if OSM's data
  doesn't have that POI. No coarser fallback exists (ADR 0007's own
  rule), so an entry can end up with no map pin the same way it always
  could.

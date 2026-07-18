# ADR 0006 — Multi-source search: Wikidata + web search, simultaneous

*2026-07-17*

## Context
`docs/api-integrations-addendum.md` describes two different search patterns
by category (referred to as "section 7" by the founder, though the file as
it stands has no numbered section 7 — it goes 1/2/3/5/6 then an unlabeled
open-decisions table. Flagged, not fixed; proceeded on the founder's message
as the authoritative spec rather than guessing at what the missing section
was meant to say):

1. **Songs (Spotify), Restaurants/Venues (Google Places):** structured
   category-API search first, "Search more" web search only as a sequential
   fallback if that comes up empty.
2. **Films, Events, Issues, Creators:** Wikidata and general web search run
   simultaneously by default, no gate, results from each populating as they
   respond.

## What's real vs. what got built
None of the three backends this depends on existed before this session, for
any category:
- **Spotify Search / Google Places Search** (Pattern 1): still don't exist.
  Both need real credentials the founder hasn't provisioned yet (Spotify
  Client Credentials OAuth app; a billed Google Cloud project with Places
  API enabled). **Not built this session** — confirmed with the founder.
  Pattern 1 categories keep today's single-link-resolve flow only; typed
  text there still shows "coming soon."
- **Wikidata search**: built. Verified live before writing any code —
  `wbsearchentities` (`src/lib/wikidataSearch.ts`) is free, keyless, and a
  real test call (`search=Inception`) correctly surfaced the 2010 film with
  a disambiguating description, alongside noise (an alias match on "date of
  establishment") that the categorizer heuristic has to work through.
- **Generalized multi-candidate web search**: built (`webSearchCandidates()`
  in `src/lib/parseLink.ts`) — distinct from `webSearchExtractEvent`, which
  converges on one answer for a specific link/description the user already
  disambiguated. This one enumerates up to 5 candidates for an ambiguous
  typed query, reusing the same "never trust a model-typed URL" discipline
  (though this pass doesn't attribute individual source URLs per candidate
  — see Consequences).

## Decisions

**Wikidata search is scoped to Films/Events/Issues only, not Creators.**
`api-integrations-addendum.md` itself specifies Creator matching as an
*exact handle-property* SPARQL match (P2002/P2003/P7085/P2397 for
X/Instagram/TikTok/YouTube), not fuzzy name search — a different mechanism
than `wbsearchentities` performs, and one that assumes a "type a handle"
UX that doesn't exist yet (today's input is a freeform description, same
box as every other category). Building a half-working name-based matcher
for Creators would have been worse than not building it. `/api/search/
wikidata` returns an empty result set (not an error) for creator types, so
the client's Wikidata section just shows no matches rather than failing.

**Every Wikidata-sourced result is tagged `wikidata_match` provenance,
including today's fuzzy label matches** — not a new, more granular tier for
"fuzzy" vs. a hypothetical future "exact" Wikidata match. The addendum's
own contrast in section 5 is between "verified against a structured
source" and "surfaced by a broader search the user eyeballed and picked" —
Wikidata vs. web search, not fine gradations within Wikidata itself. A
category description mismatch is a real risk (the live test above found
one), handled by the categorizer falling back to the search's requested
category rather than trusting a bad signal, not by inventing a seventh
provenance tier.

**Progressive population via two parallel client-side fetches, no
streaming infrastructure.** `AddToListsButton.tsx` fires `/api/search/
wikidata` and `/api/search/web` at the same time and lets each update its
own piece of state (`wikidataResults`, `webResults`) independently — no
Server-Sent Events, no streaming Response. Wikidata's own documented
slowdown under load (9-27s in the addendum's research) just means its
section fills in later; nothing blocks on it, matching the requirement
without new infra.

**Soft ranking bias via a stable sort, not exclusion.** `sortByContext()`
sorts a source's results with list-context matches first, everything else
still shown below — confirmed requirement, not new design.

**Selection reuses the existing confirm step through a new unified
`PendingEntry` shape**, rather than the confirm UI needing to know whether
it's rendering a single-link resolution or a selected search candidate.
Both `resolveAndShowConfirm()` (link/single-answer path) and
`selectCandidate()` (multi-result path) now populate the same `pending`
state. Nothing auto-writes — selecting a candidate pre-fills the same
editable title/subtitle form and destination checkbox every other path
already used, it doesn't skip the confirm step.

**Provenance now actually gets persisted, closing the ADR 0005 gap.**
`entries.provenance` existed but nothing wrote to it. `/api/parse-link` now
maps every resolution's internal `source` to a `provenance` value via the
new `sourceToProvenance()` helper before returning it to the client, and
`/api/entries` persists whatever `provenance` the client sends — covering
both this new multi-search path and the pre-existing single-link-resolve
path in the same change, rather than leaving old paths inconsistent with
the new one.

## What "only triggered if structured search comes up empty" means here
Interpreted as: the web-search fallback button for Pattern 1 categories is
still an explicit tap, consistent with section 5's "explicit, user-
initiated fallback" framing — not an automatic fire-without-a-tap when
results are empty. Flagged as an interpretation, not confirmed 1:1, since
Pattern 1 wasn't built this session to test against. Worth re-confirming
when Spotify/Places search actually gets built.

## Live-tested
Movies list, query "The Matrix": Wikidata returned 5 real results in one
call (correctly identified the 1999 film's description; also surfaced real
noise - an album, the franchise, "The Matrix series", and an unrelated
Ukrainian boxer via an alias match - confirming the categorizer's
fallback-to-requested-category behavior is doing real work, not just
theoretical). Web search returned all four Matrix films as distinct
candidates, not converged to one. Selecting the correct film candidate
correctly pre-filled the confirm step with a `MOVIES · WIKIDATA` badge.

Save failed at the very last step with `Could not find the 'provenance'
column of 'entries' in the schema cache` - the founder hasn't run the
updated `schema.sql` (ADR 0005's provenance/attributes columns, this
session's own Creator-list additions) against the live database yet. Not a
bug: the error surfaced clearly instead of failing silently, confirming
the error-handling path works. Full save-and-persist verification is
blocked on that migration being applied.

## Consequences
- Individual web-search candidates don't carry per-candidate source
  attribution (unlike Events' single-answer path, which does). One search
  call can surface multiple candidates from overlapping search results,
  and splitting "which search result supports which candidate" reliably
  wasn't attempted this pass — a `SearchCandidate` has a `sourceLabel`
  ("Web search") but no `sources: []` array the way an Events entry does.
  If a selected candidate needs richer source attribution later, that's a
  targeted single-item re-resolution (reusing the `webSearchExtractEvent`-
  style converge-to-one pattern for the specific chosen item), not
  something this pass added.
- `/api/search/wikidata` fires for every multi-search category including
  creator types, where it always returns an empty array — a small,
  accepted inefficiency (one wasted round-trip) in exchange for one
  uniform client code path instead of a category-conditional branch.
- The categorizer in `wikidataSearch.ts` is a keyword heuristic on
  Wikidata's description text, not a certainty. It will misclassify
  results whose description doesn't use the expected vocabulary; the
  fallback (use the search's requested category) means a miscategorized
  result still shows up in the right section, just without a fully
  accurate category badge.

# ADR 0008 — In-list search: structured, named-field forms per category

*2026-07-20*

## Context
`docs/api-integrations-addendum.md` section 9 draws a line between two
different search surfaces that had been sharing one implementation:
`AddToListsButton.tsx`'s global "+" flow (one free-text box, works from
anywhere, category inferred or hinted) and a not-yet-built **in-list
search** — opened from inside a specific list, where the category is
already known, so the input should be a structured form with named fields
instead of a single box. This ADR covers building that second surface
without touching the first.

Per category, the founder's spec (section 9's table) and prior status
reports left three things unconfirmed or unbuilt, discovered by reading
the actual code before starting:
- **Creators**: SPARQL exact handle-property matching (P2002/P2003/P7085/
  P2397) was documented in `api-integrations-addendum.md` and explicitly
  flagged "not built yet" in `wikidataSearch.ts`'s own comments.
- **Events**: the multi-source search from ADR 0006 already ran Wikidata +
  web search in parallel, but only against a single free-text `query` —
  no structured Name/Location/Date input existed.
- **Issues**: the closed-dropdown section tag (Politics/World/.../Other)
  was fully specified in the addendum but had no schema column, no UI.

## Decisions

**New component (`InListSearchForm.tsx`), not an extension of
`AddToListsButton.tsx`.** The two flows solve different problems (global,
any-category vs. scoped, known-category) and the founder was explicit
about not conflating them. Rendered inside `ListBoard.tsx`, alongside
(not replacing) the existing link-paste box — pasting a Spotify/Maps link
is still a valid, distinct action from typed search.

**Songs and Restaurants/Venues save directly, no confirm step.** Per the
addendum: these categories have no live catalog to search against
(`songDedupKey`/`placeDedupKey` in `normalize.ts` already do exact-match
internal-key dedup), so whatever the user types *is* the final answer —
adding a confirm screen in between would just be re-asking the same
question. Verified this is how `/api/entries` already behaved before
touching anything.

**Restaurants/Venues' City field pre-fills from `profiles.city`.** That
column already existed (seeded to `'Tampa'` by default) but nothing read
it before this change — added a `profiles.city` select to the list detail
page, passed down as `homeCity`.

**Movies/Events/Creators/Issues reuse ADR 0006's parallel Wikidata + web
search infrastructure**, not a new search mechanism — `/api/search/
wikidata` and `/api/search/web` are the same two endpoints
`AddToListsButton` calls, just fed structured query text instead of a raw
free-text box. This keeps one search implementation instead of two.

**Creators: `searchWikidataByHandle()` added to `wikidataSearch.ts`**, a
SPARQL query against `query.wikidata.org` distinct from `searchWikidata`'s
fuzzy `wbsearchentities` name search. `/api/search/wikidata` now branches
on category (`FUZZY_CATEGORIES` vs `HANDLE_CATEGORIES`) instead of only
ever calling the fuzzy path.

**Events: `webSearchCandidates()` grew an optional third argument**
(`{location, date}`) used only to enrich the web-search prompt — Wikidata's
`wbsearchentities` has no location/date filter, so only the Name field
feeds Wikidata search; Location and Date are passed through to
`/api/search/web` and folded into the prompt, explicitly telling the model
to treat the date as disambiguating (a strong signal for picking between
same-named recurring events) rather than a strict filter (an event's real
date sometimes differs slightly from what a user recalls).

**Issues: section tag stored in `entries.attributes`, not a new schema
column.** The addendum's own "store as two fields, never collapse into
one" requirement is about not conflating an "Other" pick with its
free-text description in a single value — it doesn't require top-level
columns. `attributes jsonb` already existed for exactly this purpose
("descriptive attributes... empty by default since nothing populates it
yet" — schema.sql's own comment), so `/api/entries` now writes
`{section_tag, section_other_text}` there for issue-type entries instead
of a migration adding two new columns for one category.

## Live-tested (all six category behaviors, real signed-in session)
- **Songs**: typed Title/Artist saved directly, appeared in both personal
  ranking and community ranking immediately, no candidate step.
- **Restaurants**: City field pre-filled `"Tampa"` from the profile;
  typed Name/City saved directly.
- **Movies**: search "Inception" returned 5 Wikidata candidates (correctly
  found the 2010 film alongside real noise — a book, a soundtrack, an
  unrelated computer program alias match) plus 1 web result; selecting the
  film candidate correctly pre-filled Title + the Wikidata description as
  subtitle; saved successfully.
- **Events**: Name "Gasparilla Pirate Fest" + Location "Tampa, FL" + Date
  "2027-01-30" — web search results correctly incorporated both the
  location and date (returned real Tampa Gasparilla events dated around
  that day); selecting a candidate and saving correctly wrote the typed
  date into `entries.metadata.date` (confirmed via direct query), which is
  what `/api/entries`' event fuzzy-dedup already keys off.
- **Creators**: handle `@elonmusk` against X Creator. **Found and fixed a
  real bug before this could work**: the first `searchWikidataByHandle`
  implementation used `FILTER(LCASE(STR(?handle)) = LCASE("..."))` for
  case-insensitive matching, which forces Wikidata's query service to scan
  every value of the property instead of using its index — verified live,
  this timed out with a 502 from `query.wikidata.org` every time, not an
  occasional flake. Fixed by matching against a `VALUES` list of case
  variants directly in the triple pattern instead of filtering after an
  unbound match — still indexed, confirmed live returns `Elon Musk` /
  `Q317521` correctly and fast. Saved successfully, showed Name + @Handle.
- **Issues**: dropdown renders all 12 tags + Other; selecting "Other"
  correctly reveals the free-text field. Tested with a real tag
  ("Local") + issue name "Tampa Bay redistricting fight" — web search
  returned real, current Tampa Bay redistricting coverage; saved entry's
  `attributes` confirmed via direct query: `{"section_tag": "Local",
  "section_other_text": null}`, two distinct fields as required.

## Consequences
- Movies' confirm step still shows Wikidata's raw `description` string as
  the subtitle (e.g. "2010 film directed by Christopher Nolan"), not
  separately parsed Year/Genre fields the way the addendum's display-field
  column describes. Getting real structured Year/Genre would need a
  second Wikidata call per candidate (`wbgetentities` or a SPARQL claims
  lookup) — out of scope for this pass, flagged rather than silently
  built partially.
- `searchWikidataByHandle`'s case-variant `VALUES` list only tries the
  handle as typed, all-lowercase, and all-uppercase — a handle recorded on
  Wikidata in some other mixed case (rare, but possible) still won't
  match. Widening this further trades more query cost for a narrower edge
  case; not worth it until it's an observed problem.
- The in-list search form and the global "+" button now both know how to
  drive `/api/search/wikidata` and `/api/search/web` for the same
  categories, each with its own client-side fetch/state code — no shared
  hook extracted yet. Worth revisiting if a third surface needs the same
  pattern.

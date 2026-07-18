# PeakFeed — API Integrations & List Expansion Addendum
*July 2026 · Working document, multi-session build, not yet fully implemented*

This addendum covers three things decided in the same conversation: the
realistic external API landscape beyond what's already built, a new
platform-specific Creator list structure, and a Wikipedia/Wikidata-driven
attribute strategy for Issues. Treat this as in-progress, several open
decisions are flagged at the end rather than resolved.

## 1. Realistic API integration list
Organized by what each source actually gets you, not just "does an API
exist." Confirmed by direct research in July 2026, not assumed from memory.

### Already speced and in use
Spotify (Songs), TMDB (Films), Google Places (Restaurants/Venues), Open
Library/Google Books (Books), YouTube Data API + oEmbed, TikTok public
oEmbed, Instagram/Facebook oEmbed (token requirement reversed by Meta as of
June 15, 2026, tokenless again, no app review required for basic oEmbed).

### Considered and declined — simplification, not a technical problem
**MusicBrainz and Discogs (music enrichment):** declined by choice. Spotify
alone stays the only music source, no additive secondary enrichment layer.
Not a technical failure, a deliberate simplification, fewer integrations to
maintain, Spotify's identifier coverage is already solid enough on its own.

### Films — correction, TMDB is not actually free for this use case
**Flagged and resolved:** TMDB's API is free only for non-commercial use,
$149/month commercial license once a product monetizes (negotiable above
$1M ARR). Given PeakFeed's stated data-licensing revenue model, this
product doesn't qualify as non-commercial, using TMDB under free terms
would be a real ToS violation, not a technicality. OMDb was considered and
rejected for the same reason, its free tier is licensed CC BY-NC 4.0,
non-commercial only, arguably a stricter restriction than TMDB's.

**Resolution: use Wikidata as the single resolution path for Films.**
Wikidata's data is CC0, no commercial restriction at all. Film entities
carry IMDb ID as a structured property (P345), alongside title, release
year, genre, director, cast, most of what TMDB would give. One resolution
path, including for direct `imdb.com/title/...` link shares, no separate
pattern-match shortcut, simpler to build and maintain at the cost of a
slightly slower resolve on that specific link type.

One implementation detail that still matters:
- **SPARQL latency (see section on Wikidata enrichment) applies here as
  primary resolution, not just background enrichment**, this is a live,
  user-facing wait now, not a silent background job. Cache aggressively,
  film metadata rarely changes, so repeat lookups should be near-instant.
  On a genuine cache miss, show a clear loading state rather than a blank
  wait, don't block silently.

**Revisit TMDB once real revenue exists.** This isn't a permanent
architecture decision, it's the correct free path for now. $149/month for
TMDB's richer poster/image library is a reasonable upgrade to make later,
not something to build around today.

### Events — reinstated, resolved via web search + sources, not a structured API
**Reversal of the removal above.** Ticketmaster and Eventbrite are still
out (paid / non-functional, unchanged), but the actual goal, connecting the
same real-world event across however it gets shared, doesn't require their
APIs. It only requires finding public, already-indexed pages.

**How it works:** when an Event is shared or searched, web search (Tier 4,
same LLM-assisted pattern used elsewhere in this doc) looks for public
listing pages matching it, a Facebook Events page, an Eventbrite listing,
a venue's own site. These don't require any API key or authentication,
they're just public pages being searched and linked to, not scraped via a
platform's programmatic access. Any pages found get attached as **sources**
on that event's entry, visible via the existing "See sources" action.

**Dedup uses the identifier scheme that was already designed for exactly
this**, no new architecture needed: the PeakFeed Event ID (venue Place ID +
date + normalized name + submitting user), per the original Lists
Architecture doc, was always meant to collapse a Ticketmaster link, a
Facebook event, and a photographed flyer for the same show into one entry
when venue/date/name match closely enough. That logic is unchanged, only
the extraction method underneath shifts from API-structured fields to
LLM-extracted fields from search results.

**Honest tradeoff:** this is slower and less precise than a real structured
API would have been, LLM interpretation of search snippets, not guaranteed
structured data. Flyer-photo OCR (Vision tier) remains the strongest,
most reliable path for Events, this is the fallback for link/typed-text
shares, not a replacement for it. Any event resolved this way carries the
same lower-confidence provenance tag as any other web-search-sourced
result in this doc.

**Launch list count, corrected again:** Events is back in. Five core system
lists (Songs, Restaurants, Venues, Events, Issues) plus four
platform-specific Creator lists, nine total. Still worth a look against the
original "five, concentrate density" recommendation, but Events itself is
no longer the casualty of the API cost/access problems, those are separate
from whether the category exists at all.

### Cross-cutting enrichment
**Wikidata** (SPARQL query service): structured, machine-readable facts
(nationality, genre, release year, etc.), not prose to re-parse. Free, no
auth for reasonable use. **Confirmed decision: runs async, in the
background, after an entry is already created and visible.** Never blocks
the live add/confirm flow. Caveat found in research: the public query
service has slowed under load in 2026 (some queries now taking 9-27 seconds
that used to return in under one), which is exactly why this must stay
async rather than live. If volume ever demands it, Wikimedia Enterprise API
is the paid, SLA-backed alternative.

### Confirmed dead ends — don't build, don't revisit without new information
| Source | Why |
|---|---|
| Amazon Music | No public API, bot-detection, JS-rendered shell (existing addendum) |
| share.google | Google's own share-button URL shortener, wraps a search result, no real metadata behind it, ever |
| U.S. Copyright Office (copyright.gov) | No documented public API. Current system (CPRS, replaced the old Public Catalog in 2025) is a search portal only. Programmatic/bulk access is a paid manual service ($200/hr, human-run), not viable for a live flow |

### Deprioritized, not dead
**X/Twitter API** — pricing is tightly tiered and expensive at this point,
free tier is thin. Given X is likely a small slice of actual share volume
compared to Instagram/TikTok, don't invest real integration effort here yet.
Revisit only if real usage data says otherwise, don't build for it on
assumption.

## 2. Platform-specific Creator lists (new — expands original launch scope)
**Decision:** build one system list per platform, not a single combined
"Creators" category. List titles: **X Creator**, **TikTok Creator**,
**Instagram Creator**, **YouTube Creator**.

**This changes something already documented.** The Lists Architecture doc's
original launch set was five lists (Songs, Restaurants, Venues, Events, and
*one* creator category, platform TBD). Four separate platform-specific
Creator lists is a bigger launch surface than that plan called for, not a
formatting detail. Flagging this explicitly rather than letting it quietly
supersede the five-list recommendation, see open decisions below.

### Shown attributes (default, visible to users)
- **Name**
- **@Handle**

### Full attribute capture — access reality by platform, not uniform
Important correction to plan around: "capture whatever the API gives you"
is not the same amount of data on every platform. Only YouTube offers a
genuine public profile-data endpoint. The others are largely gated behind
app review or the creator's own account connection, not available for
arbitrary public creators via a simple API key.

| Platform | What's realistically available | Access path |
|---|---|---|
| YouTube | Channel title, handle, description/bio, subscriber count (if public), video count, thumbnail, country if set | `channels.list`, public API key, genuine public read |
| Instagram | Name + handle only, from oEmbed's `author_name`/post context | oEmbed (tokenless as of June 2026). Bio, follower count, etc. require the creator's own account connection via Graph API, not fetchable for arbitrary public accounts |
| TikTok | Name + handle only, from oEmbed's `author_name` | Public oEmbed. Deeper profile data requires TikTok's gated Developer/Research API (business approval) |
| X/Twitter | Name + handle, richer profile data technically exists but sits behind paid API tiers | Deprioritized per section 1, don't build against this yet |

Identifier for all four: platform handle + platform tag, consistent with
the existing pattern already defined for Creators in the Lists Architecture
doc.

### Wikidata enrichment applies here too, matched by handle, not name
Confirmed: the async Wikidata enrichment job (section 1) runs against every
entry type, not just Songs/Films/Events/Issues, Creator entries included.
The thin platform-API attribute problem above is partially offset by this,
some creators will have real Wikidata entries with far richer bio/career
data than any platform's oEmbed gives.

**Match method matters here more than elsewhere: match by handle, not by
name.** Wikidata has dedicated properties for exactly this: Twitter/X
username (P2002), Instagram username (P2003), TikTok username (P7085),
YouTube channel ID (P2397). Query for an entity where the relevant property
exactly matches the shared handle, don't fuzzy-match on display name.
Name-matching people carries real collision risk (common names, unrelated
people sharing a name) in a way song/film title-matching mostly doesn't.
Handle-matching avoids that almost entirely: exact match or no match, no
ambiguous middle case to get wrong.

**Expected hit rate stays low, same as Issues:** most creators, even
successful ones, aren't Wikidata-notable. This enriches the public-figure/
established-creator tier and silently does nothing for everyone else, same
non-blocking, enrichment-only behavior as everywhere else this runs.

## 3. Issues — default to Wikipedia/Wikidata-sourced attributes
**Decision:** when an Issue entry matches an existing Wikipedia page, default
its attribute set to whatever that page's Wikidata entry provides, rather
than an empty or hand-typed attribute set.

**Why this actually works for both ends of the specificity spectrum:**
Wikipedia has real pages for a highly specific named person/event (e.g.
George Floyd) and for a broad general concept (e.g. social justice) alike.
Both resolve to a real Wikidata entity with its own natural attribute set.
This means a single mechanism, matching against Wikipedia/Wikidata, handles
"as specific as a named individual" and "as general as a broad social
category" without needing two different systems.

**Scope boundary, not a flaw:** this only applies when a matching Wikipedia
page actually exists. Hyperlocal issues (a specific pothole, a specific
neighborhood zoning dispute) generally won't have one. Those fall back to
the existing fuzzy-match dedup system (Tier 2, escalating to Tier 4 LLM
fallback per the Intelligence Layer doc) with no external attribute
enrichment. Wikipedia/Wikidata is an enrichment layer on top of the existing
Issues dedup logic, not a replacement for it.

## 5. "Search more" — web search as an explicit, user-initiated fallback
When a user searches by name (not handle, not a clean API match) during
search-assisted entry, and the structured search (category API, or Wikidata
handle-property match for creators) doesn't surface what they're looking
for, show a **"Search more..."** button below the initial results.

Tapping it escalates to a broader, LLM-assisted web search, producing
additional candidate suggestions. This is still a suggestion step, not
auto-write: the user reviews and picks from what comes back, same as every
other search-assisted flow in this doc. Nothing gets attached to an entry
without the user selecting it.

**Provenance matters here.** An entry resolved via exact Wikidata
property-match or a clean category API hit should be tagged differently
than one found via this broader web-search fallback. Store a confidence/
provenance field alongside the resolution, don't let "verified against a
structured source" and "surfaced by a broader search the user eyeballed and
picked" look identical in the data. Cheap to build in now, expensive to
retrofit once real data exists without it.

## 6. Add to list, from someone else's list
New universal action: any entry a user can see, whether on the Map, on
someone else's public personal list, a group list, or a Feed card, gets an
**"Add to list"** action as the *first* option in its action menu.

**Confirmed: applies everywhere an entry appears**, no exceptions. The full
action menu order, every time a list entry is tapped, anywhere in the app:

1. **Add to list**
2. **Open in** (external platform, Spotify/TMDB/Google Maps/whatever the
   source is)
3. **See sources**
4. **Share**

Because the entry already carries a resolved identifier, "Add to list"
skips the resolution/parse pipeline entirely and goes straight to the
existing multi-destination confirmation sheet (Share Ingestion Addendum,
section 2), reused as-is. Genuinely cheap to build relative to everything
else in this doc, since no new resolution logic is needed, just a new entry
point into logic that already exists.

## 7. Search is cross-category, never siloed by current screen
**Decision, and a correction to section 5's original framing:** typed
search must not be locked to whatever category the user happened to be
looking at when they opened it. Same principle as the universal "Add to
list" action, don't let entry point artificially narrow what's available.

When a user types a search string, fire it against every relevant source
simultaneously, not just the category matching the current screen. Results
are grouped or tagged by category so a genuinely ambiguous term (e.g.
"Dune," a film, a novel, potentially a themed restaurant) is disambiguated
visually, not guessed at.

**Two different source patterns, by category, not one uniform rule:**

- **Songs (Spotify) and Restaurants/Venues (Google Places):** structured
  API search first, since these already work well. "Search more" (broader
  web search) stays a sequential fallback, only triggered if the structured
  search comes up empty, not run in parallel by default. No reason to add
  search noise to a source that already resolves reliably.
- **Films, Events, Issues, Creators (no reliable structured API left for
  any of these):** Wikidata and general web search run **simultaneously**
  by default, not gated behind a "search more" click. Suggestions from both
  populate as each source responds. Note for Events specifically: Wikidata
  will rarely match anything but the largest, most notable events, cheap to
  check anyway since it runs in parallel, web search plus public source
  pages (Facebook Events, Eventbrite listings) is doing the real work for
  this category. This is the confirmed simplification, replacing the
  earlier per-category-API patchwork (MusicBrainz, Discogs, Ticketmaster,
  Eventbrite APIs, all dropped, see above) with one consistent two-source
  pattern for everything that doesn't have a clean direct API.

**Two implementation requirements this creates:**

1. **Progressive, per-source result population, not a single blocking
   wait.** Wikidata SPARQL can take several seconds under load, materially
   slower than Spotify or Places. Never let a slow source block a fast one
   from displaying, results stream in as each responds.
2. **Clear category and provenance labeling on every result.** Category
   (Film/Event/Creator/etc.) needs to be visually obvious for disambiguation,
   and source (Wikidata-verified vs. web-search-surfaced) needs the
   confidence/provenance tagging from section 1's schema work, since this
   pattern now surfaces web-search results by default, not as a deliberate
   extra step, making that distinction more important, not less.

**If search was opened from within a specific list's context** (e.g.
tapped from the Films list specifically), that category gets a soft
ranking bias, its results surface first, but other categories are never
excluded. Consistent with the confidence-based pre-checking pattern used
elsewhere in this doc, context helps, it doesn't gatekeep.

## Open decisions
| Decision | Status |
|---|---|
| Four platform-specific Creator lists vs. the originally recommended five-list launch set (one combined Creator category) — does this replace that recommendation, or does it expand launch scope on purpose? | Needs explicit confirmation, flagged above, not yet decided |
| Attribute storage schema (JSONB column per entry vs. separate attributes table) | Not yet decided, needs resolving before Claude Code builds against it |
| Wikidata Enterprise API vs. free public endpoint | Free endpoint for now, revisit if async enrichment volume or query-service slowness becomes a real problem |
| "Search more" web-search fallback: what confidence/provenance labeling scheme to use, and should low-provenance entries display any visual distinction to the user later, or just exist as backend metadata? | Open |
| Cross-category search ranking bias: does the current screen's category get a soft ranking boost, or zero influence at all? | Leaning soft bias, needs explicit confirmation |

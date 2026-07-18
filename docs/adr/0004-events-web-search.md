# ADR 0004 — Events resolve via real web search, not Ticketmaster/Eventbrite

*2026-07-17*

## Context
Events was always going to need something other than a direct catalog API —
`lists-architecture.md` never claimed one exists for small local culture,
that's the whole reason the PeakFeed Event ID scheme (venue + date + name +
submitter) was designed as a custom identifier in the first place. Two
candidate direct-API sources were investigated this session and both turned
out non-viable: Ticketmaster's terms carry the same "contact us about
commercial use" ambiguity that already caused a real mistake with TMDB
earlier the same day, and Eventbrite's public search endpoint has been
withdrawn since February 2020 — there's nothing to search against as a
third party, only lookups by an ID you already have. Both dropped entirely
rather than shipped in a narrower, misleading form.

## Decision
**Web search (Claude's `web_search_20250305` tool) is the resolution
mechanism for Events, for both pasted links and typed text.** Verified
before building: it's a real, live search — not the model answering from
training data — billed at $10 per 1,000 searches plus normal token cost, no
separate API key beyond the existing `ANTHROPIC_API_KEY`. This required
upgrading `@anthropic-ai/sdk` from 0.32.1 to 0.112.3 (80 versions behind,
predated this tool's type support); rebuilt and lint-checked clean before
adding any new code on top of it.

**Source URLs come from the API's own response blocks, never from the
model's JSON output.** `webSearchExtractEvent()` in `src/lib/parseLink.ts`
reads `web_search_tool_result` content blocks directly for the `url`/`title`
pairs Claude actually found, and separately asks for a final JSON object
(title/venue/date/confidence) as the *answer*. Two different data paths on
purpose — the same reasoning as the low-information-title guard elsewhere in
this file: never trust a URL string the model could have typed slightly
wrong, when the real one is sitting right there in the tool result.

**Confidence is always forced to `"low"` for this path**, per the founder's
explicit instruction, regardless of what Claude's own JSON claims — web
search is inherently less trustworthy than a direct API match, and nothing
in the UI should imply otherwise.

**Typed-text resolution exists only for Events, and only when the button was
opened from the Events list specifically** (`listContext.type === "event"`).
Every other category still shows "Paste a link for now — typed search is
coming soon" for non-URL input, unchanged from ADR 0003. This isn't a general
typed-search feature, it's Events-specific, gated both client-side
(`AddToListsButton.tsx`) and server-side (`/api/parse-link` rejects a `query`
body when `hintType !== "event"`, so the client-side gate isn't the only
thing stopping it).

## The PeakFeed Event ID: reduced, and with the dedup-key contradiction fixed
Two changes from the identifier exactly as originally specified, both
confirmed with the founder before building:

**No venue Place ID component.** Live Google Places API integration doesn't
exist anywhere in this codebase, for any category — `parseLink.ts` has only
ever extracted a place id that's *already sitting in* a pasted Google Maps
URL, never looked one up by venue name. Building that is separately scoped,
real cost (~$0.017/call), a new API key, new infrastructure. Today's
identifier is `event:{date}:{normalized name}` — venue omitted until that
exists.

**No submitting-user component in the dedup key, contrary to the literal
original spec.** `entries.external_id` dedups via an *exact-match* unique
index. If "submitting user" were literally baked into the ID string, the
same real event shared by two different people would produce two different
IDs and never collapse into one entry — directly contradicting "a Facebook
link, an Eventbrite link, and a photographed flyer for the same show all
resolve to one Event ID." Read "submitting user" as *provenance metadata*
instead, which the schema already captures structurally without needing it
in the ID: `entries.created_by` (whoever's insert won) and each
`list_items.added_by` (every subsequent submitter who deduped onto that
same entry).

## Fuzzy dedup, built now, not deferred
`entries.external_id`'s exact-match index only dedups two shares whose
normalized titles are character-for-character identical — unlikely across
different sources for the same real event (a Facebook page's title rarely
matches an Eventbrite listing's). `/api/entries/route.ts` now runs a
same-date token-overlap check (`tokenOverlap()`, exported from
`parseLink.ts` — Jaccard-style word-set comparison, the free/local "Tier 2"
pattern `intelligence-layer.md` describes) against existing event entries
*before* falling to the exact `external_id` match-or-insert path. Threshold
0.5 (half the shorter title's words present in the other) — untuned,
reasonable default, worth revisiting once there's real submission volume to
tune it against.

Built now rather than deferred because without it, "dedup works exactly as
originally speced" would be false — the exact-match-only fallback wouldn't
actually catch the cross-source case the whole identifier scheme exists for.
No schema change or RLS policy needed: only reads existing rows (already
publicly selectable) and inserts new ones (already allowed for signed-in
users) — never updates an existing entry's stored data.

## Sources are stored, not yet surfaced
Found source pages persist to `entries.metadata` as `{ date, sources: [...]
}` — the jsonb column already existed, no migration needed. Nothing in the
UI shows them yet. "See sources" as an actual action doesn't exist anywhere
in the real app (only in the static prototype and in the still-unbuilt
`api-integrations-addendum.md` description of it) — building that view is
separately scoped, confirmed with the founder before starting this work.
The confirm sheet shows a source *count* only ("Found via web search · 2
sources · low confidence, please verify") so the lower confidence tag isn't
unexplained, without building the full detail surface.

## Found during live testing: `max_tokens: 1024` was silently killing every result
First three live tests (a recurring team rivalry, a festival with no date
given, then the same festival with a date supplied) all came back with a
real search having happened (10-20 genuine source URLs each time, verified
by inspecting the actual API response - Amalie Arena's own site, NHL.com,
tampa.gov, Creative Loafing Tampa, FOX 13, etc.) but an empty title every
time, even when a source's own URL contained the exact date
(`nationaltoday.com/.../2026/04/10/gasparilla-music-festival-returns...`).

Root cause: `max_tokens: 1024` capped the *output* budget for the whole
tool-use turn, not just the final answer - the model's own interstitial
reasoning between searches plus echoing tool results consumed that budget
before it ever reached the final JSON, so `JSON.parse("{}")` fell back to
the empty-title path every time. Anthropic's own multi-search example in
the docs uses `max_tokens: 4096` for exactly this reason. Fixed by raising
it to 4096. Retested the same query that had failed twice - resolved
cleanly on the first attempt after the fix ("Gasparilla Music Festival" /
"Meridian Fields", 19 real sources, correctly left `date: null` since the
festival spans April 10-12 and sources disagree on a single day).

While investigating, also loosened the prompt's framing: it originally
asked the model to confirm title, venue, and date together as one unit,
which meant any date ambiguity (a multi-day event, sources disagreeing)
was tanking the *title* too. Now explicitly decoupled - "is this a real
event" and "what's the exact date" are separate questions, and the model
is told to still return its best title/venue even when the date can't be
pinned down. Also added a diagnostic log (`console.error` with
`stop_reason` and a text preview) for the case where sources were found
but no title comes back, so a similar truncation issue wouldn't silently
recur unnoticed.

**Not live-tested: the fuzzy dedup path.** The exact-match and empty-title
paths were exercised live; the same-date token-overlap dedup in
`/api/entries/route.ts` was verified by build/lint and code review only,
not by watching two independently-worded submissions actually collapse
into one entry. Each live web-search test costs real money ($10/1,000
searches + tokens), so this was judged not worth the additional spend
after the core resolution path was confirmed working - worth a live check
before relying on it in front of real users.

## Consequences
- If an entry gets deduped onto an existing one via the fuzzy match, that
  existing entry's `metadata.sources` is NOT updated with the new
  submission's found sources — only the entry actually created gets its
  sources stored. Merging sources on a dedup hit would be a reasonable
  follow-up once the "See sources" UI exists to make that data visible.
- The 0.5 token-overlap threshold is a starting guess, not tuned against
  real data. Watch for both false merges (two different events on the same
  date with overlapping generic words) and missed merges (genuinely
  different phrasing that drops below 0.5) once real submissions exist.
- `webSearchExtractEvent()`'s `max_uses: 5` caps each resolution at 5
  searches (~$0.05 + tokens per attempt, worst case). Not currently
  surfaced as a cost concern anywhere - worth tracking once Events usage is
  real rather than test traffic.

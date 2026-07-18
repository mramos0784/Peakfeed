# ADR 0005 — Resolution provenance, attribute storage, Creator lists

*2026-07-17*

## Context
`api-integrations-addendum.md` (a founder-authored planning doc, not yet
built against) flagged three concrete pieces of schema work as open
decisions: a confidence/provenance field on entries, a decision on JSONB
vs. a separate attributes table, and whether four platform-specific
Creator lists replace or expand the original five-list launch
recommendation. This session resolved all three with the founder before
writing any migration.

Also confirmed and unchanged from an earlier session: `lists.category`
and the `issues` system list both already existed — nothing to add there.

## Decisions

**Provenance: six tiers, not the three the addendum named.** The addendum
asked for "at minimum three" (direct API / Wikidata match / web search).
Proposed six instead, because three would have conflated real, distinct
mechanisms: `url_id` (today's actual Spotify-page-scrape and Google-Maps
mechanism — a canonical id already sitting in the URL, no API call, no
guess) and `ai_guess` (today's generic meta-scrape fallback, no search)
are both live in `src/lib/parseLink.ts` right now and are meaningfully
different reliability profiles from each other and from the addendum's
named tiers. Collapsing them into `direct_api` or `web_search` would have
been inaccurate labeling from day one. Confirmed with the founder before
building: `direct_api`, `url_id`, `wikidata_match`, `web_search`,
`ai_guess`, `manual`.

**Confidence is implied by provenance tier, not a separate column.** A
`web_search`-resolved entry is lower confidence than a `direct_api` match
by definition — a second, independent confidence column could only ever
agree or silently disagree with the provenance tier, never add real
information. `parseLink.ts`'s existing transient `confidence` field
(used for the pre-save confirm-sheet UI) is untouched; this is about what
gets persisted to `entries`, not the in-flight resolution response shape.

**Attributes: a new, dedicated `entries.attributes jsonb` column, separate
from `metadata`.** The founder chose this over reusing `metadata` (which
already exists and is already proven — Events' `date`/`sources` this
session) — `metadata` is operational data about *how* an entry's
resolution behaves, `attributes` is descriptive data about *what the
thing actually is* (genre, nationality, release year, from the not-yet-
built Wikidata enrichment job). Both empty-object-by-default jsonb,
nothing populates `attributes` yet.

**Four Creator lists confirmed as launch-scope expansion, not a
replacement.** `lists-architecture.md` originally recommended five launch
lists with *one* combined Creator category, platform TBD. The addendum
flagged "does this replace that recommendation, or expand it on purpose"
as an open decision (section 2, and again in the open-decisions table).
The founder's explicit instruction to add all four platform-specific
lists resolves that: expansion, on purpose, not a supersession by
accident. Four new `entry_type` enum values were needed
(`x_creator`/`tiktok_creator`/`instagram_creator`/`youtube_creator`) since
the `(type, external_id)` dedup index and the Add-to-Lists destination
matching (`systemLists.find(l => l.type === parsed.type)`) both key off
`type` — the same handle text can legitimately belong to a different
person on a different platform, so platform has to be part of the type,
not just metadata.

## What this session did NOT build
Schema only, per the instruction's scope ("Report back on all three
before moving to the next session's work"):
- Nothing writes `entries.provenance` yet — every existing resolution path
  in `parseLink.ts` (`spotify_page`/`url_id`/`ai`/`web_search`) would need
  updating to set it, and `/api/entries` would need to accept and persist
  it. Not done this session.
- Nothing populates `entries.attributes` — the async Wikidata enrichment
  job it depends on doesn't exist.
- No resolution logic exists for any Creator platform (oEmbed integration
  for Instagram/TikTok, YouTube Data API, X deprioritized per the
  addendum). The four lists exist and are visible via `getSystemLists()`,
  but pasting a creator profile link today just falls through to the
  generic `ai_guess` meta-scrape fallback, same as any unrecognized link.

## Idempotency note
Unlike most of this file's other additive changes, `CREATE TYPE` has no
native `IF NOT EXISTS` in Postgres. `resolution_provenance` is wrapped in
a `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block —
the standard idiom for an idempotent enum creation — so re-running
`schema.sql` against a database that already has this type stays safe,
consistent with every other statement in the file.

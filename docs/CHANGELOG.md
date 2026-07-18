# PeakFeed — Changelog

Running log of what shipped, in plain terms. Newest first.

## 2026-07-17 — Persistent "Add to Lists" button (Stage A)

See `docs/adr/0003-global-add-button.md` for the full reasoning, including
what's deliberately deferred.

- New floating "+" button on Map, the Lists index, and every individual
  list page — a global add entry point, separate from the per-list add box
  (which stays in place until this one is confirmed working).
- Paste-link flow reuses the existing `parseLink.ts` resolution unchanged.
  Typed free text shows "Paste a link for now — typed search is coming
  soon" instead of a fake search UI — no live-search integrations were
  built this session.
- Confirmation sheet offers the one real destination available today (the
  matching system list), built as a generic checkbox list so it doesn't
  need rebuilding once group lists exist.
- `lists.category` column added to the schema (unused today, unblocks the
  group-lists work later) plus `Issues` as a sixth system list — needs the
  founder to run the updated `schema.sql` in the Supabase SQL editor.
- `parseLink.ts`: `share.google` and Amazon Music links now short-circuit
  with a clear "can't auto-detect this" message instead of attempting (and
  failing) the normal resolution tiers. A generalized low-information-title
  guard now filters bot-block/interstitial titles ("Just a moment", "Sign
  in", generic short chrome-only titles) before they'd otherwise be shown
  as a pre-filled guess — applied to the Spotify scrape, the generic page
  scrape, and the AI's own returned title.
- **Open finding:** no TMDB/IMDb resolution tier exists — those links fall
  through to the generic AI/meta-scrape fallback with no real IMDB-ID
  extraction. Flagged, not fixed, this session; see the ADR.
- **Tested live, per the founder's request, before touching any other
  category:** a real TMDB link (`themoviedb.org/movie/27205-inception`)
  resolves via the fallback, correctly extracts "Inception" as the title
  (confirms the low-info-title guard doesn't wrongly reject short real
  titles), saves cleanly to Movies — but with `external_id: null`, so a
  second share of the same movie today would create a duplicate entry
  rather than deduping. A real IMDb link
  (`imdb.com/title/tt0133093`, The Matrix) does not resolve at all: IMDb
  returns `202 Accepted` with an empty body to the server's crawler
  User-Agent, so there's nothing to scrape. Confirmed this is IMDb's own
  bot-blocking, not a false-positive in the new title guard — the flow
  correctly falls back to a blank, manual-entry state rather than showing a
  fake guess, which is the intended behavior when nothing usable comes
  back. Both gaps have the same real fix: a proper TMDB API Tier-1
  integration (API key, official search/lookup endpoints, returns real
  IMDB IDs) would sidestep scraping imdb.com entirely and give Movies a
  clean dedup identifier. Not built this session — reported back per the
  founder's request, decision on whether to build it now is theirs.

## 2026-07-17 — Embedded prototype skips its own join screen

The interactive prototype embedded on the waitlist homepage now boots
straight into the Map screen instead of showing its own onboarding/join
form first — no visitor should face two "join" prompts back to back. See
the update note in `docs/adr/0002-waitlist-homepage.md`. Internal deep
links back to that screen (Profile → Account → "Join the waitlist") still
work; only the first-load behavior changed.

## 2026-07-17 — Waitlist homepage at `/`

See `docs/adr/0002-waitlist-homepage.md` for the reasoning.

- `/` now branches on auth state instead of always redirecting: logged-in
  users still redirect to `/lists` (unchanged), logged-out visitors get a
  waitlist homepage — wordmark/tagline, a 4-step how-it-works strip, a
  one-line description, a live embed of the interactive prototype, and a
  waitlist form.
- Moved `reference/peakfeed_v2.html` to `public/reference/peakfeed_v2.html`
  so it's servable for the iframe embed — same URL path, different disk
  location.
- New `/api/waitlist` route: validates name/email/city/interests and
  forwards to a Google Apps Script Web App via the server-only
  `WAITLIST_SCRIPT_URL` env var (documented in `.env.example`, needs to be
  set in both `.env.local` and the Vercel dashboard). Real errors surface
  to the form, nothing fails silently.
- `WaitlistForm` component: three interest checkboxes (not radio buttons —
  multi-select), submit disabled until at least one is checked.
- Small "Log in" link added to the waitlist hero so there's a way back into
  the app without typing `/login` directly.

## 2026-07-17 — Persistent nav shell (ROADMAP item 1)

Added the five-tab nav (Map / Lists / Vote Day / Feed / Profile) that
everything else attaches to. See `docs/adr/0001-persistent-nav-shell.md`
for the reasoning.

- New `(app)` route group with one shared layout: single auth check
  (replaces three duplicated `getUser()`/redirect checks), persistent
  rust header + bottom nav bar matching `peakfeed_v2.html`'s tokens.
- `lists/page.tsx` and `lists/[slug]/page.tsx` moved under `(app)/`, no
  functional changes — still real, still backed by Supabase.
- Map, Vote Day, Feed: honest "coming soon" placeholders (roadmap items
  5, 2, 3 respectively) — no fake data, no stubbed interactions.
- Profile: real page, not a placeholder. Shows username/city/join date
  from the `profiles` table and the signed-in user's 20 most recent
  votes. Sign-out moved here from the old Lists page.
- Vote Day tab shows a pulsing live dot during "vote weekend" (Friday
  8pm ET through Sunday), computed from real date math against the rule
  in `master-product-data.md` — no vote-cycle/lock table exists yet to
  drive this from real state.
- Added `.claude/launch.json` so the dev server can be previewed.

# PeakFeed — Changelog

Running log of what shipped, in plain terms. Newest first.

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

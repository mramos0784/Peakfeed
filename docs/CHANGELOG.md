# PeakFeed — Changelog

Running log of what shipped, in plain terms. Newest first.

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

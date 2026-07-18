# PeakFeed — File Map

Living document, update whenever routes/components/lib files are added or
moved. Not a full repo listing — just what a developer needs to orient.

## Routes (`src/app`)

| Path | File | Auth | Notes |
|---|---|---|---|
| `/` | `page.tsx` | — | Logged in: redirects to `/lists`. Logged out: waitlist homepage (wordmark, 4-step strip, prototype iframe, `WaitlistForm`) |
| `/login` | `login/page.tsx` | none | Standalone, no nav shell |
| `/signup` | `signup/page.tsx` | none | Standalone, no nav shell |
| `/map` | `(app)/map/page.tsx` | required | `ComingSoon` placeholder — roadmap item 5, needs entry coordinates. Also renders `AddToListsButton` |
| `/lists` | `(app)/lists/page.tsx` | required | Real: lists the system lists from the `lists` table. Also renders `AddToListsButton` |
| `/lists/[slug]` | `(app)/lists/[slug]/page.tsx` | required | Real: fetches list + items + votes, renders `ListBoard` + `AddToListsButton` (with list context) |
| `/vote-day` | `(app)/vote-day/page.tsx` | required | `ComingSoon` placeholder — roadmap item 2, needs a vote-cycle/lock table |
| `/feed` | `(app)/feed/page.tsx` | required | `ComingSoon` placeholder — roadmap item 3, needs a follow/activity model |
| `/profile` | `(app)/profile/page.tsx` | required | Real: username/city/join date from `profiles`, recent votes from `votes` |
| `(app)/layout.tsx` | — | enforces auth | Shared layout for all 5 tabs — single auth check, renders `AppShell` |

`(app)` is a Next.js route group: it doesn't appear in the URL, it just
lets the 5 authenticated tabs share one layout without `/login` and
`/signup` inheriting it.

## API routes (`src/app/api`)

| Path | Purpose |
|---|---|
| `api/auth/signout` | POST, signs out and redirects to `/login` |
| `api/entries` | POST, creates an `entries` row + `list_items` row after a parsed link is confirmed |
| `api/parse-link` | POST, resolves a pasted URL via `src/lib/parseLink.ts` (Spotify/Places pattern match, falls back to Claude via `/api/parse-link`) |
| `api/vote` | POST, writes the signed-in user's ranked order to `votes` for the current week |
| `api/waitlist` | POST, no auth. Validates name/email/city/interests, forwards to the Google Apps Script Web App at `WAITLIST_SCRIPT_URL` (server-only env var, never sent to the client) |

## Components (`src/components`)

| File | Purpose |
|---|---|
| `AddToListsButton.tsx` | Client component: persistent floating "+" button (Map, Lists index, list detail pages) opening the global add flow — paste-link only today, see ADR 0003 for staged scope |
| `AppShell.tsx` | Client component: persistent rust header + bottom nav bar, active-tab highlighting, live dot on Vote Day during vote weekend |
| `ComingSoon.tsx` | Shared placeholder for nav tabs with no backend yet (Map, Vote Day, Feed) |
| `ListBoard.tsx` | Client component: the actual Lists-screen functionality — paste-link parse/confirm, personal ranking, vote submission, community ranking display. Per-list add box, kept in parallel with `AddToListsButton` until that's confirmed working |
| `WaitlistForm.tsx` | Client component: name/email/city + interest checkboxes, posts to `/api/waitlist`, surfaces real errors, disabled submit until ≥1 checkbox is checked |

## Lib (`src/lib`)

| File | Purpose |
|---|---|
| `supabase/client.ts` | Browser-side Supabase client (anon key, RLS-gated) |
| `supabase/server.ts` | Server-side Supabase client (Server Components/Route Handlers, cookie-backed session) |
| `parseLink.ts` | Share-ingestion resolution: pattern-matches Spotify/Google Maps URLs first, escalates to the Anthropic API server-side only when no clean pattern matches. Short-circuits known-unsupported sources (Amazon Music, share.google) and filters bot-block/interstitial titles before they'd otherwise be presented as a guess |
| `systemLists.ts` | `getSystemLists()` — the live system-list set from the `lists` table, shared by `AddToListsButton` and the Lists pages instead of each querying it separately |
| `voteWeek.ts` | `currentWeekOf()` — which Monday a vote counts toward. `isVoteWeekend()` — real date math (America/New_York) for the Friday-8pm-through-Sunday window the nav's live dot uses |

## Root

| File | Purpose |
|---|---|
| `src/proxy.ts` | Next.js middleware, keeps the Supabase session cookie fresh on every request (does not gate routes — auth gating lives in `(app)/layout.tsx`) |
| `src/app/layout.tsx` | Root HTML shell: Bebas Neue + DM Sans fonts, Tabler icons webfont (used by `AppShell`'s nav icons) |
| `src/app/globals.css` | Brand color tokens (rust/slate/olive/sage/mist) + `pf-*` classes for the nav shell, `wl-*` classes for the waitlist homepage |
| `supabase/schema.sql` | Full DB schema, version-controlled — `profiles`, `entries`, `lists` (now with a `category` column, unused today), `list_items`, `votes`. Additive changes use `alter table ... add column if not exists` so re-running the file against an existing database is safe |
| `public/reference/peakfeed_v2.html` | The static design prototype — moved here (from `reference/` at repo root) so the waitlist homepage can embed it in an iframe at `/reference/peakfeed_v2.html`. Still the CLAUDE.md-referenced visual target, just servable now. |

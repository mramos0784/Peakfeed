# ADR 0001 — Persistent tab navigation shell

*2026-07-17*

## Context
ROADMAP item 1: a persistent five-tab nav (Map / Lists / Vote Day / Feed /
Profile) that everything else attaches to. Before this, the app had no
shared layout — `RootLayout` just set fonts. Three pages (`/`, `/lists`,
`/lists/[slug]`) each independently called `supabase.auth.getUser()` and
redirected to `/login` on their own. Only Lists had a working feature
behind it; Map, Vote Day, and Feed don't have backend yet (roadmap items
2, 3, 5 — no coordinates on entries, no vote-cycle/lock table, no
follow/activity model).

## Decision
**Route group for shared chrome, not a per-page component.** Added
`src/app/(app)/layout.tsx` as a Next.js route group layout. It's the one
place that checks auth and redirects to `/login` — the three duplicated
checks are gone. `AppShell` (a client component) renders the rust header
and bottom nav once, and persists across client-side navigation between
tabs instead of remounting per page.

**Honest placeholders for unbuilt tabs, not stubs.** Map, Vote Day, and
Feed render a `ComingSoon` component naming the roadmap item and pointing
back to Lists. No fake data, no mock state standing in for a backend that
isn't there — consistent with CLAUDE.md's instruction not to stub or fake
functionality. When each of those ships, `ComingSoon` gets swapped for the
real page; nothing about the nav shell needs to change.

**Profile is real today, not a placeholder, even though full Profile is
item 4.** The `profiles` table (username, city, created_at) already
existed and was unused by any UI. Rendering it isn't building ahead of the
roadmap — the data was already there and working. Vote history is pulled
from the existing `votes` → `lists`/`list_items`/`entries` tables, capped
at the 20 most recent, no aggregation or streak logic added. Confirmed
with the founder before building (session decision, 2026-07-17) rather
than assumed.

**Vote Day's live dot is computed from real date math, not a DB flag.**
`isVoteWeekend()` in `src/lib/voteWeek.ts` checks the current time against
America/New_York, encoding the master doc's stated rule (lock Friday 8pm,
through the weekend). No vote-cycle/lock table exists yet to drive this
from real state — that's future work on the Lists screen's Friday-lock
mechanic. This is a defensible stand-in because it's derived from a rule
already agreed in `master-product-data.md`, not fabricated data. It should
be replaced by a real cycle-state read once that table exists.

**Sign-out moved from Lists to Profile.** The old Lists page carried a
"Log out" button because it was the only page with any chrome. Now that
Profile exists and owns account-level actions, sign-out lives there
instead — matches where a user would look for it, and Lists no longer
needs its own auth-adjacent UI.

## Consequences
- Adding a 6th tab later means adding a page under `(app)/` and one line
  in `AppShell`'s `TABS` array — no auth or layout wiring needed per page.
- The vote-weekend dot will silently go stale if the real lock/cycle table
  ships without updating `isVoteWeekend()` to read it. Flagged here so
  that's not missed.
- `(app)/lists/[slug]/page.tsx` still fetches `user` itself (for filtering
  the signed-in user's votes out of `allVotes`), so it keeps a `notFound()`
  null-guard on `user` even though the layout already guarantees a session
  — that's a type-safety guard, not a duplicate auth redirect.

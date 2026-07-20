# ADR 0011 — Follow/unfollow, public profiles, username search

*2026-07-21*

## Context
Prior status check confirmed follow/unfollow didn't exist at all - no
table, no route, no UI - and that Feed can't be built without it. This
session builds the prerequisite only: the `follows` relationship, a way
to reach another user's profile, and the follower/following counts on
Profile. Feed itself and any post/activity-sharing toggle stay explicitly
out of scope, per instruction.

Confirmed before building: **no route existed to view anyone's profile
but your own** (`/profile` was self-view only, no user directory, no
search, nothing anywhere linked a username). "Follow, reachable from a
profile page" presupposes a profile page for other users, so building
`/profile/[username]` was a required part of this session, not optional
scope creep.

Two changes made to the original plan, both instructed:
1. `list_items.added_by` stays exactly what it was - a server-side-only
   field for the delete-ownership check (ADR 0010) - never rendered, never
   linked. System lists are shared community content, not publicly
   attributed to individual contributors.
2. Username search (`profiles.username`, partial match) is the actual
   discovery mechanism instead, temporarily homed on the self-view
   `/profile` page until Feed exists to hold it properly.

**Public lists' independence, confirmed before building**: no bearing on
this piece. Public lists blocks on the unbuilt Personal lists feature
(`list_kind='personal'`) - a *list*-visibility concern. Follows are a pure
user-to-user relationship, no dependency on lists at all. Shipped
follower/following counts with zero relation to that gap.

## Decisions

**`follows` is the entire model, not a partial one awaiting a
request/accept flow.** Master Product Data section 8 is explicit -
"Unlimited, one tap, public counts" - no cap, no approval step, no
private/pending state. Composite primary key (`follower_id, followed_id`)
does double duty: it's the natural "already following" dedup (a repeat
follow just upserts onto the same row via `onConflict`, never a unique-
constraint error the client has to handle as a special case) and it's the
whole storage model - no `status` column, because there's no second state
a follow relationship can be in.

**`follows` RLS is public-read, unlike `reports`/`jobs`.** Those two are
deliberately unreadable by anyone (internal/moderation-only). `follows` is
the opposite by design - "public counts" means anyone's follower/following
relationship is visible, not just the two people in it - `select using
(true)`, same pattern as `votes`/`list_items`, not the jobs pattern.

**`/profile/[username]` is a separate, thinner page, not a parameterized
version of self-view `/profile`.** Self-view shows recent votes and a log-
out button - personal, not meant for a visitor. The public page shows only
what Master Product Data's public-profile fields actually call for that's
actually built: avatar, username, city, join date, follower/following
counts, Follow button. Visiting your own username redirects to `/profile`
rather than rendering a second, thinner copy of your own page - one
canonical self-view, not two versions that could drift apart.

**Username search is a real API route (`GET /api/users/search`), not a
client-side filter over an already-fetched list.** No user directory
exists to filter client-side in the first place, and `profiles` could
grow large - a server-side `ilike` query scales the same way regardless of
table size, a client-side filter wouldn't.

## Live-tested (real signed-in session, throwaway account, cleaned up after)
- Self-view `/profile`: follower/following counts render (`0 · 0`,
  gracefully - the `follows` table didn't exist on the live database yet
  at test time, confirmed via direct query it's the same `PGRST205`
  pattern as the last two sessions, not a code bug), search box present.
- Username search: searched `"olmanolo"`, correctly partial-matched
  `@olmanoloart`, result linked to `/profile/olmanoloart`.
- Public profile page: rendered the founder's real profile (avatar,
  `@olmanoloart`, city, join date, counts, Follow button) from a second
  account's session.
- Clicking Follow correctly attempted the write and failed cleanly (500,
  confirmed `PGRST205` again via direct query) rather than corrupting
  client state - button stayed "Follow," no false-positive toggle.
- Visiting your own username (`/profile/claude-test-follows`) correctly
  redirected to the real self-view `/profile`.
- Visiting a nonexistent username correctly 404s.

## Consequences
- **Follow/unfollow's actual write path is unverified end-to-end** - same
  standing gap as Report and list-delete before it. Everything up to the
  point RLS would enforce is confirmed correct; the write itself (and the
  "already following → Unfollow" toggle state, and counts actually
  incrementing) needs a real pass once `schema.sql` is applied.
- Username search has no debounce and no minimum-length guard - a single
  explicit Search-button submission per query (matching this app's
  existing convention, e.g. `InListSearchForm`, rather than live-as-you-
  type), so this isn't a live-query-per-keystroke cost concern, but a
  one-character query still runs a real `ilike '%x%'` scan. Not a problem
  at current volume; worth adding a minimum length if `profiles` grows.
- `UserSearchBox` is explicitly temporary real estate on `/profile` -
  flagged in its own comment - and will need to move once Feed exists,
  per instruction, not treated as its permanent home.

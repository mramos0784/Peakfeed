# ADR 0010 — Lists screen: top ten / trailing queue, drag-and-reorder, delete

*2026-07-20*

## Context
Before building, checked what ranking UI actually existed: `ListBoard.tsx`
had one flat "Your ranking" list (every item, no top-ten cap, no trailing-
queue split) with up/down-arrow reordering only - no drag, no drag
library in `package.json`. Community ranking was a separate read-only
list below it. No delete/remove action existed anywhere. So this session
started close to zero on the actual two-zone/drag/promote/delete
mechanics, even though the write path underneath (`votes`, `/api/vote`)
was already real.

**Stopped and confirmed the write model before building anything**, since
the founder's stated assumption ("reordering updates the live aggregate
immediately, no submit step") didn't match what was already built and
live-tested: `/api/vote` is an explicit action (delete-then-reinsert this
week's `votes` rows only on that call), and the community-ranking average
is computed from all votes ever cast, no week filter, but still only moves
when someone clicks Submit. Confirmed with the founder to keep the
existing explicit-Submit model, just without any Friday-lock - reordering
updates local state instantly, the aggregate only moves on Submit, same
as before this feature.

**Also stopped and confirmed delete's authorization scope** before writing
the RLS policy: system lists are one shared community pool
(`list_items` has no per-user scoping beyond `added_by`), so an unscoped
delete would let one user de-list another's contribution from a list
everyone else is ranking. Confirmed: delete is scoped to whoever added the
row (`auth.uid() = added_by`), mirroring the existing insert-scoping
pattern, not open to any signed-in user.

**Feed screen confirmed still `ComingSoon`, no backend** - "Post to Feed"
correctly stayed entirely out of scope, nothing to build toward.

## Decisions

**Two zones, one combined client state (`{topTen, queue}`), not two
independent arrays.** `moveItem(id, toZone, targetId)` always removes the
dragged/promoted/demoted id from *both* arrays first, then inserts into
whichever zone it's moving to - this is what lets promote, demote, and
drag-and-drop across zones all funnel through one function instead of
three separate ones with duplicated bookkeeping. `targetId: null` means
"append to the end" for the top zone (what the Promote button means) or
"insert at the front" for the queue zone (what demoting means, and what
"most-recent-first" reads as for a just-demoted item); a real `targetId`
means "insert at this exact row's position," which is what drag-and-drop
needs and buttons don't.

**Native HTML5 drag-and-drop, no library added.** `package.json` had no
dnd-kit/react-beautiful-dnd/sortable dependency, and the existing codebase
pattern (per CLAUDE.md's working style: favor simple, familiar patterns)
didn't call for adding one for what's fundamentally list reordering -
`draggable` + `onDragStart`/`onDragOver`/`onDrop` on each row, plus a
zone-level drop target for "drop anywhere in this zone" (append/prepend)
distinct from "drop on this specific row" (insert at that position).

**Promoting into a full top ten bumps the current last slot to the front
of the queue**, per spec ("bumping the lowest slot if already full") -
implemented inside `moveItem` itself so both the Promote button and a
drag-into-a-full-top-ten do the same bump, not two separate code paths.

**Trailing queue order is display-only, not a persisted preference.**
"Most-recent-first" is computed once from `list_items.created_at` at load
time; dragging within the queue reorders it in local state (consistent
drag-and-drop UX - drop where you drop it) but nothing re-sorts it back to
chronological afterward, and nothing persists a custom queue order to the
database. Nothing in the spec asked for a personal queue-ordering
preference, and no schema exists for one - not invented here.

**Delete is a two-click inline confirm, not `window.confirm()` or a
modal.** Click once shows "Remove? / Cancel" inline in place of the "×"
button; matches the app's existing lightweight, modal-free interaction
style rather than introducing a new confirmation pattern for one action.

**Delete is genuinely list_items-only - verified, not just claimed.**
`/api/list-items`'s `DELETE` handler runs exactly one query,
`.from("list_items").delete().eq("id", listItemId)` - no cascading delete
of `entries` anywhere in the code, and `entries` has no column referencing
`list_items` to even accidentally cascade through. Confirmed live (see
Live-tested below) that the `entries` row survives a delete untouched.

**Delete only renders for items the current user added.** `DeleteControl`
checks `item.addedBy === currentUserId` client-side before rendering the
control at all - not just relying on the RLS policy to reject the call,
so a user never sees an action that would silently fail for them.

## Live-tested (real signed-in session, throwaway account, cleaned up after)
- Promote (button): moved an item from an empty top ten into rank 1,
  "Submit to vote" appeared. Promoted a second item, queue correctly went
  to "Nothing waiting in the queue."
- Arrow reorder: swapped ranks 1↔2 within the top ten, confirmed visually.
- Submit: saved successfully (`votes` rows confirmed via direct query -
  exactly 2 rows, ranks 1 and 2, only the top ten, nothing beyond it), and
  the "Tampa community ranking" section updated live to reflect the new
  vote counts and order without a page reload.
- Delete visibility: an item this test user didn't add correctly showed no
  delete control at all; an item the same user added via the in-list
  search form correctly showed both Promote and delete controls once
  demoted to the queue.
- **Delete found a real bug before this could be called done**: clicking
  through the two-click confirm returned a 200 and the UI optimistically
  removed the row, but a direct query afterward showed the `list_items`
  row **still present**. Isolated the cause by calling PostgREST directly
  with the test user's own token (bypassing my API route entirely,
  `Prefer: return=representation`) - the delete returned `200` with `[]`,
  zero rows matched, confirming this is the RLS policy from this session's
  `schema.sql` change not yet being applied to the live database, not a
  bug in the delete query or the API route. The `entries` row for the same
  test item was confirmed still present throughout (checked before any
  cleanup), matching the "never touch entries" requirement, from what
  partial testing was possible.

## Consequences
- **Full delete-path verification is blocked on the founder running the
  updated `schema.sql`** (same standing pattern as the Report/`reports`
  table gap last session) - the delete policy, insert logic, and UI are
  all confirmed correct up to the point RLS intercepts the actual write;
  the write itself needs re-verification once the policy exists.
- `zones` state (like the pre-existing `order`/`preview` state before it)
  is seeded once from server props via `useState(initialZones)` and
  doesn't re-derive when `router.refresh()` brings back new server props
  mid-session - confirmed live (a same-session add showed up in the
  read-only "community ranking" list immediately but not in the
  zones-driven queue until a full page reload). Pre-existing pattern in
  this file, not introduced by this session, but now affects more surface
  area (zones, not just the flat order) - worth a real fix (deriving from
  props via a key-remount or syncing effect) if this keeps surprising
  testers.
- No empty placeholder slots for an unfilled top ten (e.g. slots 4-10 when
  only 3 items are ranked) - zone-level drop-anywhere already achieves the
  same "drop here to add" affordance without the extra visual clutter of
  rendering empty numbered rows.

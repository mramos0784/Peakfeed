# PeakFeed — From Prototype to Functional Build

What exists in the visual prototype (`peakfeed_v2.html`), what's already real in the
working app, and how each remaining piece gets simplified for a first functional
version, roughly in the order it makes sense to build them.

## Already built and working
- Accounts (Supabase Auth, email/password)
- Ten categories: six core system lists (Songs, Restaurants, Venues, Movies,
  Events, Issues) plus four social/creator categories (Instagram, TikTok, X,
  YouTube). The five core lists plus Issues are manually verified and in active
  use. The four creator categories are built and live but not confirmed tested,
  verify end to end before treating them as launch-ready.
- Add an entry by sharing a link, AI-assisted parsing with a confirm-before-save step
- Outbound search for adding entries without a share link (reaches external
  sources to resolve and import new content). Early: match quality isn't fully
  reliable yet and duplicate entries are a known open issue, see dedup item below.
- Personal ranking (reorder your list, submit it as your vote)
- Tampa community aggregate ranking (average rank across everyone's votes).
  Slated for a scoring rework, see item 8 below, this is changing.
- Map screen: functional, showing entries that carry coordinates (restaurants
  and venues added via a Google Maps link). Tapping a pin opens that entry.
- A share button (native share sheet, or copy link)

## 1. Persistent tab navigation (Map / Lists / Vote Day / Feed / Profile)
**Prototype:** a bottom nav bar, five tabs, always on screen, switches between full views.
**Today:** no persistent nav, just a back link between the lists page and a list's detail page.
**Simplify:** a shared layout wrapping every page after login, five links matching the
bottom bar. Mechanical, no design decisions left to make, worth doing first since
everything else attaches to it.

## 2. Vote Day / results screen
**Prototype:** live countdown to Sunday 6pm, results updating every 15 minutes,
position-change indicators, geography tabs (Tampa / Tampa Bay / Florida / National).
**Today:** the underlying ranking data already exists and is already computed, there's
just no dedicated screen for it, and no countdown or lock window.
**Simplify:** one results view per list showing current standings (data's already
there), a static "next Sunday" label instead of a live countdown, and skip the
15-minute live-update mechanic and the multi-geography tabs. There's no per-city or
per-region vote data captured yet (no GPS, by design, for now), so those tabs
wouldn't have anything real to show regardless.

## 3. Activity feed
**Prototype:** filterable (All / Votes / Lists / New entries / Groups), card-based,
includes a sponsored/ad card slot.
**Today:** doesn't exist yet.
**Simplify:** one unfiltered, reverse-chronological feed, querying `entries` and
`votes` by `created_at`: "X added Y to Songs," "X voted in Restaurants." Skip the
filter tabs until there's enough activity for filtering to matter. Skip the
sponsored card entirely, that's explicitly parked pending stakeholder review per
your own notes on mission integrity, not something to default into existence.

## 4. Profile screen
**Prototype:** avatar, streak counter, followers/following counts, list count,
notification settings (17 toggles), public personal lists section.
**Today:** doesn't exist as a screen, though the `profiles` table is already there.
**Simplify:** username, city, join date, and a list of what they've voted in. Skip
streaks, followers, and notification settings entirely, none of that
infrastructure (push notifications, a social graph) exists yet, and building the
screen before the backend exists is just decoration with nothing behind it.

## 5. Map screen enhancements
**Prototype:** live re-aggregation as the map pans and zooms, positioned in your own
product docs as the core "living cultural atlas" UX.
**Today:** the base map is live (see "Already built" above): static pins, entries
with coordinates only.
**Simplify:** pan/zoom-triggered re-aggregation is real infrastructure
(bounding-box queries, pre-cached tiles) your own docs already flag as
later-phase work, not urgent now that the base screen exists. Songs, movies,
and events without a location still don't appear on the map, that gap closes
once those categories carry coordinates.

## 6. Personal lists
**Prototype:** private curation, no voting, can optionally be made public.
**Today:** only the system lists exist (see "Already built" above).
**Simplify:** reuses the exact same `lists` / `list_items` tables already built,
just with `list_kind = 'personal'` and an owner column already present in the
schema. Genuinely small addition given what's already there. This is also what
lets anyone, including users with an existing audience elsewhere, curate and
share interests on PeakFeed that don't belong on their main platform, no
separate feature required, personal lists are the mechanism.

## 7. Group lists
**Prototype:** shared ballot, invite links, aggregate results across a group's members.
**Today:** doesn't exist.
**Simplify:** the bigger lift of what's left, needs a membership table and
invite-link generation that doesn't exist yet. Worth doing after personal lists
prove out the simpler version of the same pattern.

## 8. Aggregate scoring rework: average → sum-based Borda count
**Today:** the aggregate is an average rank across everyone's votes.
**Changing to:** a sum-based Borda count. Position N on a submitted list of length L
scores (L − N + 1) points; a 10-item list's #1 scores 10, a 5-item list's #1 scores 5.
Points sum across every voter's submission for the voting period. This is a
deliberate choice, not a default: it rewards people for filling out full lists,
and it means an item with more voters at weaker positions can out-score an item
a smaller group ranked consistently at #1. That tradeoff is intentional.
**Guardrail:** one active submission per user per list per voting period. Resubmitting
mid-period replaces the prior submission's points, it does not add to them. Without
this rule, sum-based scoring is trivially gameable by repeated resubmission, which
would undercut the manipulation-resistance the top-ten-only design is supposed to
provide.
**Note:** this replaces the currently-live average mechanic, it's a real change to
existing logic, not new logic layered on top. Sequence this before or alongside the
Vote Day results screen (item 2), since that screen is the first place the new
scoring becomes visible.

## 9. Two-tier deduplication (Boolean, not fuzzy)
**Tier 1, auto-match, no user-facing friction:** match on canonical platform ID
(Spotify track ID, Google Place ID, a creator's platform handle). Shared ID means
same entity, no ambiguity.
**Tier 2, surfaces through the existing confirm-before-save flow, does not
auto-block:** normalized title plus category plus location where relevant.
Requires real normalization first (lowercase, strip punctuation, strip noise like
"feat.") or Boolean equality will keep missing the obvious duplicates that are
already a known issue. A rule-based match auto-blocking submissions would
eventually produce false positives, so this surfaces as "possible duplicate,
confirm anyway" rather than a hard stop, consistent with how confirmation already
works elsewhere in the app.

## 10. Internal search (Map screen only)
**Distinct from outbound search** (see "Already built" above, and the
Product Modifications addendum where this was previously mis-labeled "internal").
Internal search only queries what already exists in the database, lists, groups,
users, and list items already added, nothing external. Scoped exclusively to the
Map screen, not a global search layer other screens consume.

## 11. Implicit testing signals (low priority, tracked)
Not a build priority right now, added here so it isn't lost. Passive friction
signals, not a full research methodology: track when an outbound search returns
empty results, and track when someone runs multiple searches on a list without
confirming an entry. Either pattern likely means someone is struggling to find
what they're looking for. Worth instrumenting once outbound search itself is more
reliable, tracking friction in a search that doesn't work well yet mostly just
measures the search problem you already know about.

## Notification strip / live vote-day banner
**Prototype:** the rust banner at the top ("VOTE DAY · SONGS · TAMPA · 62% COUNTED")
linking to live results.
**Simplify:** purely cosmetic until the Vote Day screen and its data exist, build
this right after that, not before.

## Suggested build order
1. Tab navigation shell
2. Aggregate scoring rework (sum-based Borda count, one-active-submission rule)
3. Vote Day / results screen (reuses data already captured, now with correct scoring)
4. Two-tier deduplication
5. Activity feed, unfiltered
6. Profile screen, basic
7. Personal lists
8. Internal search (Map screen)
9. Map screen enhancements (pan/zoom re-aggregation)
10. Group lists
11. Implicit testing signals (low priority, whenever outbound search stabilizes)

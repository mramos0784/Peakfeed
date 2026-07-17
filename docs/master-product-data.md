# PeakFeed — Product & Data Architecture (Master)
*The single source of truth for what PeakFeed is and how it is built — v1.0, June 2026*

When this document conflicts with any earlier document, this document wins.
Archived (superseded, historical only): the May 2026 Addendum and May 2026
Context document — do not build from them, particularly on account age
weighting, where this document is correct (no weighting, period).

Related specialist docs: `lists-architecture.md`, `location-voting.md`,
`intelligence-layer.md`, `share-ingestion-addendum.md`.

## 1. What PeakFeed is
A weekly community-driven ranking platform. People rank the best of what they
find — songs, places, events, issues, and more. The community votes. On a
defined cycle, a definitive ranked feed emerges per list, aggregated by
geography from neighborhood to nation. The underlying mission is civic: to
normalize rank voting as public expression.

**Three things no other platform does together:**
- **Community ranking** — genuine human judgment, not engagement algorithms
- **Geographic aggregation** — a live map showing rankings by neighborhood/city/
  state/nation, a living cultural atlas
- **User-controlled automation** — rankings trigger actions in apps people
  already use (e.g. a Spotify playlist built from ranked songs); the human
  curates, the system executes

**Governing principles:** community first, not algorithms. Civic purpose —
ranking is voice, taken seriously. One person, one vote — every verified
account counts equally. No autonomous ranking — automation executes on human
rankings, never generates or modifies them. Radical inclusion — broad audience,
no gatekeeping.

## 2. The core loop
1. **Share or enter** — user shares something to PeakFeed, or enters directly
   for custom lists. Browser-beta: copy-paste URL. Native target: device share
   sheet.
2. **Parse and queue** — PeakFeed resolves the identifier, drops it into the
   right list's trailing queue.
3. **Curate the top ten** — user promotes items from the trailing queue into
   their top ten. Only the top ten counts toward aggregation.
4. **Vote day** — on cycle, rankings update publicly. Users revise-and-submit
   or resubmit unchanged; both require deliberate action. No submission, no vote.
5. **Results** — updated rankings publish next day with vote-share bars. Users
   see where picks landed and can campaign for them.

**The rank queue, two zones:** Top 10 (only items counting toward aggregate,
user-curated, drag-reorderable — this is the vote) and Trailing queue (everything
else, newest first, visible but not counted, the pool to promote from).

Top-ten-only aggregation is the first and strongest defense against
manipulation — a bad actor must corrupt a meaningful percentage of active voters
in a city, not one or two accounts. Community-building is an integrity
investment, not just a growth one.

## 3. System lists
Ship pre-built, aggregate geographically, feed the map/cultural authority/data
licensing. Full detail: `lists-architecture.md`.

| List | Identifier | Source |
|---|---|---|
| Songs | ISRC | Spotify API or MusicBrainz |
| Films | IMDB ID | TMDB API |
| Podcasts | Spotify/Apple Podcasts ID | Spotify or Apple API |
| Books | ISBN | Open Library or Google Books |
| Restaurants | Google Place ID | Google Places API |
| Venues | Google Place ID | Google Places API |
| Events | PeakFeed Event ID (built) | Venue + date + name + user |
| Issues | Agent-deduplicated topic string | User-defined, agent confirms |
| Visual Artists/Creators/Fashion | Platform handle + category | Manual entry, handle as anchor |

**Events:** no external standard covers small local culture, so PeakFeed builds
its own ID from venue Place ID + date + event name + submitting user. Dedupes
the same event shared by different users while capturing events that exist
nowhere else. Flyer-photo OCR parse directly serves the small-event use case.

**Issues — two layers:**
- *Issues list (ranked):* users rank up to ten issues by importance, aggregates
  geographically like any system list. Ranks what people care about, not which
  outlet covered it.
- *Article resource feed (not ranked):* every article/video/link shared on that
  topic inside the issue, sorted by date and share count. A reading resource,
  not a vote.

**Launch set:** five lists to concentrate voting density — Songs, Restaurants,
Venues, Events, Issues. Remaining lists ship once participation supports them.

## 4. Custom & group lists
Full detail: `lists-architecture.md`.

| Type | Aggregation | Geographic constraint |
|---|---|---|
| Standalone custom list | Private to the user | None |
| Group list | Aggregated across all members | None — members can be anywhere |

- **Entry:** a name plus up to three creator-labeled identifier fields. Photo-
  share lets users snap a product and have the agent pre-fill fields.
- **Ballot mechanic:** the group's collective entries build a shared ballot;
  each member ranks from it on their own list; all rankings aggregate on vote
  day; members can view each other's ballots.
- **Self-moderation:** a misplaced entry only carries the votes of whoever added
  it, sits at the bottom with one vote.
- **Cadence:** creator sets weekly/biweekly/monthly/on-demand.

## 5. Location & voting mechanics
Full detail: `location-voting.md`.

- **Address as source of truth:** private, encrypted, never displayed or sold
  individually. Geocoded to a coordinate pair — store the coordinate, not just
  the city label, since it drives geographic assignment and future district
  mapping.
- **GPS verification:** required only at account setup and location changes, no
  background tracking. Device GPS must be within 30 miles of stored coordinate.
  Location changeable once per calendar month; previous location stays active
  30 days after a change.
- **Two location tags on every vote:** *voter location* (which city-level list
  the vote contributes to) and *entry location* (where the entry appears
  geographically) — independent of each other.
- **Geographic hierarchy:** city → region → state → country, all tagged
  simultaneously from a single coordinate. Powers both the map and the
  aggregation engine. Voting districts are a future layer requiring no rebuild
  if coordinates are stored from day one.

## 6. Scoring & vote day
**Points model:** position 1 = 10 points down to position 10 = 1 point.
Aggregate score = sum of points received; highest score ranks first.

**One person, one vote:** every verified account contributes equally. No
account age weighting, no activity multipliers — reverses the May 2026 docs'
weighting mechanism. Non-negotiable, consistent with the civic framing.

**Vote day ritual:**
- Framed as a civic event ("Tampa's music rankings update tonight"), not a task
- Resubmit mechanic: revise-and-submit or resubmit-unchanged, both require
  action. No submission, no vote, no streak.
- New shares nudge: if unreviewed queue items exist, a single prompt appears
  before submission ("You have 3 new shares... review or skip and submit?")
- Streak counter: tracks consecutive cycles, no reward attached, survives
  relocation
- Post-vote results: rankings publish next day with vote-share bars; a
  "campaign for your picks" button opens the share-card flow

**Vote persistence:** votes count during the active cycle only; individual
votes don't linger once a cycle closes. Past winners archived publicly on the
website (not in-app) — permanent record, licensee front door.

## 7. Vote integrity & bot prevention
Binary system: an account is verified and votes, or isn't and doesn't. No
shadow scoring, no silent weight reduction, no hidden penalties.

Reconciled with one-person-one-vote: integrity now rests entirely on confirming
accounts are real. No mechanism makes one verified vote count less than another.
Velocity detection, social graph correlation, and enhanced thresholds are
**parked** — activated only if stakeholders find them valuable once the
platform has enough population to make them meaningful (before that, they
can't distinguish genuine from suspicious behavior and would penalize real
users).

| Mechanism | How it works |
|---|---|
| Top-10-only aggregation | Structural — manipulation requires corrupting many real voters, the primary defense |
| GPS verification at setup + location change | Binary verified/not verified, no penalties for unverified — they simply can't vote in system aggregation until verified |
| Behavioral logging from day one | Every share/change/follow/vote timestamped and stored; no action taken at launch, builds baseline for future mechanisms |
| Share receipt logging | Logged for future use only; can't distinguish genuine signups from coordination without a baseline population |
| Transparent vote counts | Public results make implausible spikes visible; engaged users become organic watchdogs |

**Bot prevention:** phone verification + device fingerprinting at signup; share
receipt minimum (organic share history before votes count); behavioral cadence
analysis (synchronized off-hours batch submissions are detectable); social
graph density logged as a signal only, no weight adjustment at launch;
outsourced identity via Spotify/Google/Apple's own bot detection.

A tight founding community that knows each other is a social layer bots can't
fake — bridging digital identity to real-world participation (PeakFeed events)
is a genuine competitive moat.

## 8. Social layer
Kept standard and familiar.

| Element | Behavior |
|---|---|
| Search | Single input returns both lists and users, clearly labeled |
| Profile | Display name, city, vote streak, public lists, follower counts |
| Follow | Unlimited, one tap, public counts |
| Favorites | Star up to ten accounts, private only, never shown on profile |
| Feed | Chronological from followed accounts, no algorithmic reordering. Opt-in — nothing surfaces unless the posting user enabled it. Default is private; global toggle at launch, per-list control is future. |

## 9. UX architecture
Four primary screens, one persistent notification strip. No screen does
another screen's job.

| Screen | Primary purpose | Does NOT do |
|---|---|---|
| Map | Discovery and geographic context | No submissions, editing, search bar |
| Lists | Curation and participation | No map, no feed browsing |
| Vote Day Dashboard | Live results and final stats | No list editing |
| Feed | Social activity from followed accounts | No ranking, no direct voting |

**Map screen** (default landing screen): square map fills top half, list panel
slides up from below. One geographic list active at a time via dropdown.
Entries with a physical location get colored dots; entries without (songs,
issues, books) appear only in the list column. Tap a dot → tooltip (name, rank,
points); second tap → entry detail. Panel dropdown shows subscribed lists plus
suggested system/group lists with active voter counts. Tapping a list entry
opens an action sheet: open externally, view on PeakFeed, share this entry.
Auto-aggregate by view: column shows top ten for whoever falls within current
map bounding box; city/region pre-cached, custom zoom queries live with
debounce (neighborhood-level aggregation is future, architecturally supported
from day one). Vote day notification strip sits above the map header on every
screen during vote weekend/results week — always present, never dismissible
during vote weekend.

**Lists screen:** the full participation surface — map and feed are read-only,
this is where users act. Header: list name, submitted badge, city label, vote-
day countdown bar. Top ten zone: ten numbered draggable slots, up/down arrow
alternative for accessibility, removing sends back to trailing queue — only
this zone contributes to the aggregate. Trailing queue: everything shared/
entered but not promoted, most-recent-first, draggable, promote button, accepts
additions even during lock. **Lock state:** rankings lock Friday 8pm local time,
release Monday — top ten can't be reordered/promoted/submitted, but the queue
stays fully active. **Three actions:** Save (private draft), Submit (sends
current top ten to aggregation), Post (shares to opted-in followers) — all
independent. Post toggle defaults off, remembers last state. After submitting,
button turns green → "Revise submission"; previous submission stays active
until replaced.

**Vote Day Dashboard:** opens from the notification strip.
| State | When | Shows |
|---|---|---|
| Vote night (live) | Sunday 6pm until close | Live % counted, movement indicators (up/down/new), 15-min update countdown, live vote-share bars |
| Results week | Mon–Sat | Final results from last cycle, participation stats, movement from previous cycle, shareable card |

Two dropdowns: list switcher, geography switcher (city/region/state/national).
Share button generates a card with current live or final state. Campaign cards
shared to feed carry live vote standings that update in real time.

**Feed screen:** chronological, opt-in only, finite (not infinite scroll).

| Card type | Trigger | Content |
|---|---|---|
| Vote submitted | User submits + post on | Submitted badge, city/list label, top-three preview |
| New entry added | User adds entry + post on | Entry card, sub-label, user's current rank |
| Campaign card | User shares a campaign | Entry card + live vote standings, updating during vote night |
| List updated | User reorders + post on | Specific change described |
| Group results | Group vote day closes | Group name, winner, top-three preview |

Filter chips: All, Votes, Lists, New entries, Groups (default All). Reactions
not in scope at launch; view count per card is a future candidate. "You are
caught up" is a definitive end state, not manufactured content.

**Navigation:** persistent bottom nav, five tabs — Map, Lists, Vote Day, Feed,
Profile. Vote Day carries a live pulsing dot during vote weekend. Rust-deep
background, mist text, matching prototype colors.

**Notification settings (Profile > Notifications):** default state minimizes
noise, most on by default except follower activity (off by default). The
signature feature: **rank position change** — notify only when a specific
community-ranked entry the user has ranked changes its position number (not on
every leaderboard update). Sub-option: all changes vs. top-three-only.

## 10. Intelligence & automation layer
Full detail: `intelligence-layer.md`. Most of what sounds like AI is a good API
call; simple methods handle the common case, LLM is the rare-case fallback.

| Tier | What | Cost | Examples |
|---|---|---|---|
| 1. API calls | Direct external service calls | Near zero | Spotify metadata, Google Places, playlist creation, geocoding |
| 2. Pattern matching | String matching on own servers | Free | URL normalization, issue dedup first pass |
| 3. Vision API | OCR and image classification | ~$0.0015/image | Flyer parse, product photo parse |
| 4. LLM | Fallback only | ~$0.001–0.005/call | Ambiguous flyer, uncertain issue match |

At 1M MAU, estimated AI compute across all tiers is under $4,000/month against
data-licensing revenue projected in the millions. If AI were turned off
entirely, the core product still works — a risk-managed architecture.

**What AI does NOT do:** feed curation, vote scoring, content moderation,
recommendations — all deliberately AI-free (chronological feed, arithmetic
scoring, community-weight moderation). Trend analysis across vote data is a
genuine future use case but belongs in a separate data product, not the user
experience.

## 11. Geographic aggregation & data
The map is core UX — a real-time picture of what different communities value,
a living cultural atlas.

**Data licensing** — enabled by the architecture. Public leaderboard is the
proof of concept, not the product. Sellable asset is everything underneath,
always anonymized and aggregated — individual behavior is never sold.

| Data layer | Who pays and why |
|---|---|
| Behavioral velocity | Early-curve detection (labels, festival bookers, brand teams) |
| Geographic taste divergence | Tourism boards, urban planners, campaign teams |
| Cross-category affinity | Consumer intelligence for brands entering a market |
| Issue-and-source intelligence | What a community ranks most important and which sources it trusts |

Clean identifiers (ISRC, IMDB ID, Place ID) are what make the data legible to
buyers and credible as real, community-generated, manipulation-resistant data —
a direct revenue enabler.

## 12. Cut and out of scope
| Item | Reason |
|---|---|
| Account age/activity weighting, velocity detection, social graph correlation as vote weight modifiers | Inconsistent with one voice, one vote; also can't function without an established baseline population at low user counts |
| Politicians as a system list | Moderation burden, election-cycle manipulation risk, positioning conflict |
| News as a system list | Outlet bias, identifier problem, manipulation risk — replaced by Issues + article resource feed |
| AI in feed, scoring, moderation, recommendations | Deliberately excluded to protect trust |
| Hard follow cap | Following is unlimited; only favorites capped at ten (private organizing tool) |
| Native share-sheet at beta | Browser beta uses copy-paste; native share sheet arrives with React Native app; Android Web Share Target is the bridge |

## 13. Open decisions (consolidated from all specialist docs)
See `open-decisions.md` for the full consolidated list.

## 14. Build path
| Phase | What | Who |
|---|---|---|
| Phase 1 | Deploy existing prototype to free hosting, add email capture, gather early Tampa feedback | Founder, no developer |
| Phase 2 | Browser MVP as a React Progressive Web App — real accounts, real data, Google Places, copy-paste input, Android share-target. Built with Claude Code as coding partner, deployed on Supabase and Vercel | Founder + Claude Code |
| Phase 3 | Native app in React Native, translating the PWA rather than rebuilding — full share-sheet, Spotify OAuth, all integrations | Developer |

**Documentation discipline:** every feature built in Phase 2 produces inline
comments on non-obvious parts, a short Architecture Decision Record (the
product reason behind the technical choice), an updated file map, and a running
changelog — so a professional developer can inherit and extend this rather
than reverse-engineer it.

## Noted for future development (not in scope for beta or initial native build)
| Feature | Description |
|---|---|
| Embedded music on map screen | Top-ranked song for the geography in view autoplays as the user scans the map; persistent mini-player. Requires Spotify/Amazon Music/YouTube Music OAuth + streaming API access. |
| Amazon Music and YouTube Music connectors | Same OAuth pattern as Spotify; all three use ISRC as common identifier |
| Neighborhood-level aggregate rankings | Live bounding-box query, pre-cached at city/region, debounced custom zoom |
| Per-list feed activity toggle | Global toggle at launch; per-list control is a future refinement |
| Voting district layer on the map | GIS shapefiles + coordinate → district assignment; no rebuild needed if coordinates stored from day one |
| Live 15-minute update alerts (vote night) | Opt-in push notifications on each results update |
| View count on feed cards | Tap-through signal without like-count social anxiety |
| RCV organization partnerships | FairVote and similar — approach only after demonstrable traction |

# PeakFeed — Lists Architecture Guide
*System Lists · Custom Lists · Identifiers · Vote Mechanics — June 2026, working document*

Living document. Open decisions are flagged at the end. Nothing here is locked
until stress-tested against real platform constraints.

## 1. The problem every list solves
Rankings only mean something if the same thing counts as the same thing. A song
titled differently on Spotify vs Apple Music is one song, not two — if the system
treats those as separate entries, votes scatter and the leaderboard lies.

**The rule:** one entry, one identifier, globally consistent. If two users add
the same thing in different words, the identifier collapses them into a single
ranked entry.

## 2. System lists
Ship with PeakFeed, aggregate to city/state/national. Feed the map, the cultural
authority, and the data licensing business. Carry the full weight of integrity
infrastructure, so they need the cleanest identifiers available.

**Clean identifiers exist:**

| List | Identifier | Source |
|---|---|---|
| Songs | ISRC | Spotify API, or MusicBrainz (open source, platform-independent) |
| Films | IMDB ID | TMDB API (free, returns IMDB + TMDB IDs) |
| Podcasts | Spotify / Apple Podcasts ID | Spotify or Apple Podcasts API |
| Books | ISBN | Cleanest identifier of any category |
| Restaurants | Google Place ID | Google Places API |
| Venues | Google Place ID | Google Places API |

**Workable but messier:**

| List | Identifier | Note |
|---|---|---|
| Visual Artists | Instagram handle | Manual entry; IG API heavily restricted |
| Creators (IG/TikTok/YouTube) | Platform handle + platform tag | Same handle can exist across platforms; tag disambiguates |
| Fashion | Instagram handle | Same approach as Visual Artists |

Why ISRC and not title text: it anchors a song globally and survives formatting
differences, keeping aggregation honest and the data legible to licensees (a
label wants to know a track ranked in twelve cities, not that twelve spellings
of a title appeared somewhere). This does not generalize — films use IMDB ID,
venues/restaurants use Place ID. The data model is built category by category,
there is no single universal identifier.

### Events: a built identifier
Events are temporary — a restaurant's Place ID persists for years, a show at a
venue next Friday is over by Saturday. Depending on Eventbrite or any single
ticketing platform builds bias in (captures the festival, misses the backyard
show). So PeakFeed builds its own identifier:

**PeakFeed Event ID** = Venue Place ID + standardized date + normalized event/artist
name + submitting user. A Ticketmaster link, a Facebook event, and a photographed
flyer for the same show all resolve to one Event ID when venue, date, and name
match closely enough.

The flyer parse: user photographs a flyer, the agent OCRs + extracts venue/date/
artist, confirms in the bottom sheet before creating the record. Directly serves
the small-event use case and feeds the data argument (structured event data that
exists nowhere else).

Event sub-categories (starting set, not a constraint): Live Music, Art Opening/
Exhibition, Food and Market, Film Screening, Community Gathering, Festival,
Sports and Recreation, Theater and Performance.

### Entries stay separate, relationships are offered
A venue and a show at that venue are different entries. When a shared item could
touch more than one list (share an event → offer to also rank the venue), the
system offers a follow-up rather than collapsing entries. Two entries, one share.

### Launch scope
Full shelf is ten categories — too many for a Tampa Bay beta with low user counts.
**Recommended launch set: five lists — Songs, Restaurants, Venues, Events, and
one creator category.** Density of participation makes rankings feel authoritative;
that's the product. Remaining lists ship once participation density supports them.

## 3. Custom lists and groups
Custom lists rank what system lists don't cover: sneakers, craft beer, skateparks,
dog-friendly patios. This is the expansion engine — subcultures build their own
lists and bring their own users.

| List type | How it aggregates | Integrity burden |
|---|---|---|
| Standalone custom list | Private to the user, doesn't roll up to city rankings | Light |
| Group list | Aggregated across the group regardless of member location | Group-scoped |

Key difference from system lists: system lists aggregate by geography, group
lists aggregate by membership.

### The custom list workflow
Custom lists don't have a canonical URL the way a Spotify track does, so they use
structured entry instead of the share mechanic. Each entry has:
- **Name** (required, text)
- **Identifier fields** — up to three, labels defined by the list creator (sneakers:
  Brand/Model/Colorway; murals: Artist/Location/Year; barbershops: Name/
  Neighborhood/Specialty)

Deliberately kept to a form, not a form engine — three user-labeled text fields
is enough flexibility without building a Notion/Airtable-scale product. The
differentiated path is photo-share: user photographs a sneaker, the agent reads
brand/model/colorway from the image and pre-fills fields for confirmation.

### The ballot mechanic
Group lists work like a shared ballot. The group's collective entries build the
ballot; each member ranks from it, deciding where each entry lands on their own
list. Members can view each other's ballots. On vote day, every member's ranking
aggregates into the group result. Ranked-choice voting applied to culture. New
entries from any member expand the shared ballot for everyone.

### Self-moderation
Group lists have a moderator (the creator), but the system is mostly self-
moderating. A misplaced entry (e.g. a sandal on a sneaker list) only carries the
votes of whoever added it — sits at the bottom with one vote and stays there. No
report button or removal queue needed. The moderator role is a backstop, not a
daily job.

### Variable vote frequency
Creator sets cadence — weekly (fast categories like music), biweekly, monthly
(slower categories like books), or on-demand (creator calls a vote when ready,
e.g. a film club after each screening).

## 4. One note on scope
System lists are civic infrastructure (geographic aggregation, the map, cultural
authority, data business). Custom/group lists are a social game (friend groups,
subcultures, shared ballots, variable cadence). Both are in scope for the initial
build — building both at once spreads engineering effort across two surfaces,
accepted with eyes open. Revisit if timelines slip.

## 5. Open decisions
| Decision | Status |
|---|---|
| Final launch list count: five recommended, ten possible | Open |
| Which single creator category launches first (IG/TikTok/YouTube) | Open |
| Spotify integration: read-only metadata first, OAuth playlist write later | Sequencing agreed, timing open |
| Instagram/TikTok API limits may force manual entry for creators | Needs developer validation |
| Photo/flyer parse: confirm agent OCR accuracy on real flyers | Needs testing |
| Group list integrity: lighter than system lists, but define the floor | Open |

Politicians were considered and cut as a list category: moderation burden,
election-cycle liability, positioning risk against the cultural-platform
identity. Revisit only with a clear moderation plan in place.

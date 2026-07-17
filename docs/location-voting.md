# PeakFeed — Location Authentication & Voting Mechanics
*Address Verification · Geographic Hierarchy · Vote Attribution · Scoring — June 2026, working document*

Companion to the Lists Architecture Guide. Together they define the data model
a developer needs for the core voting infrastructure.

## 1. The location model
A Tampa ranking shaped by people who actually live and eat and go to shows in
Tampa means something; a ranking gamed by out-of-market accounts means nothing.
The location model's one job: establish where a person actually lives with
enough confidence to make their city-level vote meaningful, without building
surveillance infrastructure or friction that drives real users away.

### Address as source of truth
Users provide a home address at account setup. Private data — never surfaced in
the app, never sold individually, used only for verification and geographic
layer assignment. Geocoded to a coordinate pair on submission; the coordinate
pair is what the system actually operates on, the address is just the human-
readable anchor.

| Data point | Storage | Use |
|---|---|---|
| Home address | Private, encrypted | Verification anchor only. Never displayed, never sold. |
| Coordinate pair | Private, derived from address | Geographic layer assignment, GPS check, future district mapping |
| City/Region/State/Country tags | Associated with account | Vote attribution, map display, aggregation queries |

**Legal note:** address is PII under CCPA/GDPR. Privacy policy must state what
it's collected for, that it's never sold individually, and the retention period.
Attorney review required, and must be live in the app **before** the first
address is collected, not after.

### GPS verification
Required at exactly two moments: account setup and every location change.
Between those moments the declared location is trusted completely — no
background tracking, no periodic check-in, no passive monitoring.

Device GPS position must be within 30 miles of the stored coordinate pair to
confirm. **Why 30 miles:** someone setting up at their job in Brandon during a
lunch break shouldn't fail Tampa verification. Accepts a small amount of
geographic noise rather than punishing normal behavior.

Verification triggers:
- Account creation — required before system list voting activates
- Location change — required at the moment of change; previous location stays
  active until the new one is verified and the 30-day window closes

Verification is NOT triggered by: normal app use, voting/browsing/sharing, or
traveling (a visitor's vote still counts toward their home location).

### Location changes
Once per calendar month. Mirrors real-world reality that people move before
updating official records; the 30-day limit prevents gaming without punishing
genuine relocation.

| Scenario | What happens |
|---|---|
| User changes location | GPS verification required. Previous location active 30 days, new location activates after. |
| User travels to another city | No change triggered. Votes count toward home location. Visitor experience elsewhere is full and unrestricted. |
| User moves, changes location, votes during 30-day window | Votes count toward previous city. Acceptable noise. |
| User tries to change location twice in one month | Second change blocked until the monthly window resets. |

Real-world analogy: a person can vote at their previous polling location with a
still-valid address before their ID updates. Real voting systems accept a small
amount of locational noise; PeakFeed does too — eliminating every drop would
cost more in verification infrastructure than the noise costs in data quality.

## 2. Geographic hierarchy & the map connection
The map is not a display layer bolted onto a separate voting system — the
geographic layers it visualizes are the same layers the voting system attributes
votes to. One data model serves both.

| Layer | Example | How it populates |
|---|---|---|
| City | Tampa, St. Petersburg | Votes from users whose coordinate falls within city boundaries |
| Region | Tampa Bay, Miami-Dade | Rolls up all city-level votes within the metro region |
| State | Florida | Rolls up all regional votes within the state |
| Country | United States | Rolls up all state-level votes nationally |

Every vote is attributed to all four layers simultaneously at the moment cast —
no reprocessing needed, the coordinate pair already knows which layers it
belongs to.

### Two location tags on every vote — critical detail for the data model
| Tag | Definition | Example |
|---|---|---|
| Voter location | Geographic layers tied to the voter's home address | Tampa resident → counts toward Tampa city, Tampa Bay region, FL, US |
| Entry location | Geographic location of the thing being ranked | A St. Pete restaurant → appears in St. Pete city rankings, Tampa Bay region, FL, US |

These are independent. A Tampa voter ranking a St. Pete restaurant does not push
that entry into Tampa city rankings — it pushes it into St. Pete city rankings.
The voter's identity determines which city-level list they contribute to; the
entry's location determines where the entry appears geographically.

### Future: voting districts
US House district boundaries are public GIS shapefiles (Census Bureau). A
coordinate pair can be checked against them for automatic district assignment.
**Requires no architectural change as long as coordinate pairs are stored from
day one, not just city name strings.** Store the coordinate; the label is for
display only.

## 3. Account thresholds
Two integrity constraints, neither applying to the social layer:

| Constraint | Applies to | Does not apply to | Rationale |
|---|---|---|---|
| 2-week waiting period | System list votes toward public city aggregation | Group list voting, personal lists, browsing, sharing, queue building | Adds real operational cost to bot farms without penalizing genuine new users |
| GPS verification at setup | System list vote activation | Browsing, sharing, group lists | Confirms physical proximity to declared address before civic vote counts |

Group lists are open immediately — someone invited to a sneaker ranking group
shouldn't wait two weeks. The two-week threshold applies only to public civic
aggregation (city/region/state/national).

## 4. Scoring model
Simple positional points, transparent and explainable in one sentence.

| Position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Points | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 |

Aggregate score = sum of all points contributed by voters who included that
entry in their top ten. Highest score at cycle close ranks first.

**Why simple:** a sharper-weighted curve would differentiate the top of the
leaderboard slightly more, but a system any user can explain to a friend in one
sentence has a retention/trust advantage that outweighs marginal precision.
Revisit only if leaderboard compression becomes a real problem at scale.

### One person, one vote
Every verified account contributes equally regardless of tenure, list count, or
activity. Account age weighting was considered and cut — it creates a two-tier
citizenship problem inconsistent with the civic framing. **Non-negotiable.**

## 5. Vote persistence & historical record
Votes count during the active cycle only. Once a cycle closes, individual votes
don't linger in the live aggregate — rankings reflect current sentiment, not
residue from inactive voters.

**Streak counter:** tracks consecutive cycles participated in. Visible on the
confirmation screen and profile. No reward attached — the number itself is the
mechanic. Survives relocation (measures participation, not geography).

**Historical archive:** past winners archived publicly on the website, not in
the app. Gives winning real meaning, gives journalists/researchers/licensees a
front door, documents cultural trends over time, and gives visitors (who can't
vote toward a city they don't live in) a genuinely useful discovery/travel tool.

## 6. Open decisions
| Decision | Status |
|---|---|
| Exact city boundary definition: city proper vs metro area | Open. Needs GIS boundary source decision before geographic assignment is built. |
| Geocoding API: Google Maps vs Mapbox vs OpenStreetMap | Open. Google most accurate, has cost per call; Mapbox/OSM cheaper alternatives. |
| Address retention period after account closure | Open. Legal review required. |
| GPS spoofing: accept as possible, or add secondary verification | Accepted as low-priority at launch. Revisit if it becomes a documented problem. |
| District mapping timeline | Future state, no timeline. Architecture supports it from day one if coordinates are stored. |

# PeakFeed — Project Context for Claude Code

Tampa Bay's cultural rankings, built by you. Community-driven ranking platform:
songs, restaurants, venues, events, ranked weekly by one-person-one-vote.
Owner: Ol Manolo Art, LLC (Manny Ramos, sole founder, no prior coding background,
building this with Claude Code as coding partner).

## Stack and where things live
- Next.js app, deployed on Vercel, auto-deploys on push to `main`
- GitHub: `mramos0784/Peakfeed`
- Supabase: auth (email/password) + database. Schema lives in `supabase/schema.sql`,
  version-controlled. Real data lives on Supabase's servers, not in git.
- Anthropic API called server-side only, from `src/lib/parseLink.ts` via
  `/api/parse-link`. Never exposed to the browser. Only invoked when a shared
  link has no clean pattern match (not a Spotify track URL, not a Google Place ID).
- `.env.local` holds real secrets (Supabase URL/key, Anthropic key), gitignored,
  never committed. Vercel holds its own separate copy in dashboard env vars.
- No custom domain wired yet (`peakfeed.app` not pointed at Vercel). Testing on
  the `vercel.app` URL. No staging environment, no monitoring/alerting yet.

## Visual reference
`peakfeed_v2.html` is a static design prototype (not live code, but the visual
target). Brand system: Bebas Neue (display font), DM Sans (body font).
Palette: Rust `#5E2524`, Slate `#34495E`, Olive `#656B59`, Sage `#B3CB84`,
Mist `#C3D3DE`.

## Product model — non-negotiable decisions
- **List types are distinct:** system lists (Songs, Restaurants, Venues, Events,
  one creator category) aggregate by geography and feed the map. Personal lists
  are private curation, no voting mechanic. Group lists are containers for
  multiple votable lists, sharing a single ballot across members regardless of
  where members live.
- **Vote integrity is deliberately simple:** one person, one vote, GPS-verified
  at setup and on location change, no account-age weighting, no vote weighting
  of any kind. Don't reintroduce weighting without an explicit product decision.
- **Identifiers anchor every entry** so duplicates collapse instead of scattering
  votes: ISRC (songs), IMDB ID (films), Google Place ID (venues/restaurants),
  ISBN (books), custom PeakFeed Event ID (venue + date + name + submitter) for
  events. Full rationale in `docs/lists-architecture.md`.
- **Group lists are self-moderating.** A misplaced entry just sits at the bottom
  with one vote. No removal queue, no report button required as a first build.
- **Multi-destination sharing requires a confirmation step.** A single share
  action can match multiple eligible lists, but silent fan-out into group lists
  breaks the shared-ballot consent model. Always show a confirmation sheet with
  pre-checked destinations before writing to any group list.
- **Sponsored/paid list placements are explicitly parked**, pending stakeholder
  review on mission integrity. Do not build or stub this without being asked.

## Build order (from ROADMAP.md — don't reorder without reason)
1. Persistent tab nav shell (Map / Lists / Vote Day / Feed / Profile) — everything
   else attaches to this, build first
2. Vote Day / results screen (data already exists, just needs a view)
3. Activity feed (unfiltered, reverse-chronological to start)
4. Profile screen (basic: username, city, join date, vote history — skip streaks/
   followers/notifications, no backend for those yet)
5. Map screen (static Tampa map, pins only for entries with coordinates)
6. Personal lists (reuses existing `lists`/`list_items` tables, `list_kind = 'personal'`)
7. Group lists (needs new membership table + invite-link generation)

## Documentation discipline (already agreed, keep following it)
Every feature built produces, alongside the code: inline comments on non-obvious
parts, a short Architecture Decision Record (the product reason behind the
technical choice, not just what changed), and an updated file map, plus a running
changelog. The goal: a developer could inherit this codebase later without
reverse-engineering it.

## Working style
- Favor simple, familiar patterns over clever ones. Push back if a solution is
  getting overcomplicated instead of building it as asked.
- Flag open product decisions rather than silently picking one — see
  `docs/open-decisions.md`.

## Deeper reference docs
See `/docs` for full detail when a decision needs the complete reasoning, not
just the summary above: `lists-architecture.md`, `location-voting.md`,
`intelligence-layer.md`, `master-product-data.md`, `share-ingestion-addendum.md`,
`open-decisions.md`.

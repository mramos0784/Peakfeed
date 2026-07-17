# PeakFeed — Open Decisions (Consolidated)
Pulled from every specialist document. Most need resolution once a developer
(or Claude Code, in practice) is actually building the relevant piece. Check
this before making an irreversible architectural choice on any of these —
if you're about to pick one, that's fine, but note the choice here or in the
relevant doc so it doesn't get silently relitigated later.

## Product / lists
- Final launch list count: five recommended, ten possible
- Which single creator category launches first (IG / TikTok / YouTube)
- Spotify integration: read-only metadata first, OAuth playlist write later —
  sequencing agreed, timing open
- Instagram/TikTok API limits may force manual entry for creators — needs
  developer validation
- Photo/flyer parse: confirm agent OCR accuracy on real flyers — needs testing
- Group list integrity floor: lighter than system lists, but undefined
- Can users follow a group the way they follow a person? If yes, group vote
  results appear in the main feed, not just the Groups filter
- Can a group list that reaches a size threshold get surfaced in city-level
  aggregate rankings? Currently group lists are group-only regardless of size
- Public personal lists on the map layer: separate map layer, or not shown at
  all? Affects what the map shows when no system list is selected

## Location / geography
- City boundary definition: city proper vs metro area at the city layer —
  needs GIS boundary source decision
- Geocoding API: Google Maps vs Mapbox vs OpenStreetMap — cost vs accuracy
- Address retention period after account closure — legal review required
- GPS spoofing: accepted as low-priority at launch, revisit if it becomes a
  documented problem
- Voting district layer timeline — future state, architecture supports it if
  coordinates are stored from day one

## Intelligence / AI
- LLM provider: Anthropic, OpenAI, Google Gemini, or self-hosted (Llama,
  Mistral) — evaluate when developer engaged
- Vision API provider: Google Vision vs AWS Rekognition vs Azure — Google
  consolidates with existing Places/geocoding usage
- Tier 3→4 confidence threshold — needs testing on real flyer images
- Tier 2→4 confidence threshold (issue dedup) — needs testing on real input
- Self-hosted embedding model vs external LLM for issue dedup — worth
  evaluating for the most frequent AI use case
- Tier 4 data licensing product: scope and timeline — future, don't scope
  until traction

## Share ingestion (July 2026 addendum)
- URL proxy implementation: Netlify Functions vs Supabase Edge Functions —
  Netlify is simpler since the site's already deployed there; Supabase
  consolidates backend. Evaluate in Phase 2.
- Category tag field for list creation — flagged dependency, not yet added
  to Lists Architecture, needed for share destination matching to work
- Audio fingerprinting (ACRCloud, AudD) for caption-free video — not
  committed to, flagged as the only real path if that gap needs closing

## Sponsored content
- Sponsored list item format, placement, and labeling — **parked pending
  stakeholder review.** Not a build question, a mission-integrity question:
  a sponsored item at position one undermines the community ranking; a
  labeled sponsored item below the organic top ten is a different product.
  Do not build or stub this without explicit sign-off.

## Build path
- Browser beta build path: Claude Code + Supabase vs Bubble — resolved in
  favor of Claude Code + Supabase (code transfers to React Native later),
  kept here since it was an open decision as of the master doc

# PeakFeed — Intelligence & Automation Layer
*What Needs AI · What Needs an API · What Needs Neither · Cost Model — June 2026, confidential*

**Governing principle:** most of what sounds like AI is just a good API call.
PeakFeed routes almost nothing through a language model — simple methods handle
the common case, smarter methods are the fallback for the rare case. Keeps
compute costs manageable, reduces dependency on any single AI provider, and
produces predictable behavior. AI is infrastructure here, not marketing language.

## 1. Four implementation tiers
Every automated action sits in one tier. The system always tries the cheapest
tier first and only escalates when the cheaper method can't handle the case.

- **Tier 1 — API calls.** Direct calls to external services, structured/
  predictable responses, near-zero cost, deterministic, no AI. E.g. Spotify
  metadata, Google Places, TMDB, geocoding, Spotify playlist creation.
- **Tier 2 — Pattern matching & lightweight algorithms.** String matching, URL
  normalization, fuzzy dedup. Runs on PeakFeed's own servers, essentially free
  at any scale. E.g. URL canonical matching, Levenshtein distance for issue
  dedup, tracking-parameter stripping.
- **Tier 3 — Vision API.** OCR and image classification via a third-party vision
  service. ~$0.0015/image. E.g. flyer photo parsing for events, product photo
  parsing for custom lists.
- **Tier 4 — LLM.** Called only when cheaper methods fail or confidence is below
  threshold. Infrequent by design. ~$0.001–$0.005/call. E.g. ambiguous flyer
  parsing, uncertain issue dedup, unrecognized URL disambiguation.

**Escalation rule:** Tier 1 handles it → if not, Tier 2 → if not, Tier 3 → if
not, Tier 4 → if Tier 4 isn't confident enough, surface the field to the user
for manual confirmation. The user always has final say.

## 2. Use cases by tier

### Tier 1 — API calls (no AI cost at any scale)
| Use case | What happens | API | Cost |
|---|---|---|---|
| Spotify URL pasted | Extract track ID, call metadata endpoint, return title/artist/ISRC | Spotify Web API | Free tier |
| TMDB/film URL pasted | Call TMDB with title or ID, return film name/year/IMDB ID | TMDB API | Free |
| Book URL/ISBN pasted | Call Open Library or Google Books, return title/author/ISBN | Open Library API | Free |
| Podcast URL pasted | Call Spotify/Apple Podcasts API, return show name/ID | Spotify/Apple | Free |
| Restaurant/venue URL pasted | Parse Google Maps URL or call Places API, return name/address/Place ID | Google Places API | ~$0.017/call |
| Spotify account connect | OAuth handshake, store access token | Spotify OAuth | Free |
| Spotify playlist from top ten | Create playlist, add tracks by ISRC | Spotify Web API | Free |
| Address geocoding at setup | Convert home address to coordinate pair | Google Geocoding API | ~$0.005/call, one-time per user |
| GPS verification check | Compare device GPS to stored coordinate, check within 30 miles | Device GPS (native) | Free |
| Geographic layer assignment | Check coordinate against city/region/state/country boundary files | GIS data (Census Bureau) | Free, one-time download |
| Article feed sort | Query shared articles by issue tag, sort by date + share count | Internal DB query | Free |
| URL dedup for article feed | Strip tracking params, normalize, check against existing | Internal string processing | Free |

### Tier 2 — Pattern matching & lightweight algorithms (free, runs locally)
| Use case | What happens | Method |
|---|---|---|
| Issue dedup, first pass | Fuzzy match against existing entries, returns confidence | Levenshtein/token overlap (fuzzywuzzy, RapidFuzz) |
| Event dedup, first pass | Check same venue/date/similar name | Exact match on Place ID + date, fuzzy match on name |
| Article URL normalization | Strip UTM params, session tokens, platform tracking | Regex pattern library |
| Platform handle disambiguation | Check if a handle exists under a different list category | Exact string match |

### Tier 3 — Vision API
Called when a user submits a photo. Only escalates to LLM if confidence is
below threshold.

| Use case | What happens | Service | Cost |
|---|---|---|---|
| Flyer photo → event entry | Extracts event/artist name, venue, date; pre-fills form for confirmation | Google Vision / AWS Rekognition | $0.0015/image |
| Product photo → custom list entry | Classifies brand/model, pre-fills creator-defined fields | Google Vision | $0.0015/image |

**Cost projection:** 10K MAU × 2 photo inputs/mo = 20K calls ≈ $30/mo. 100K MAU
≈ $300/mo. 1M MAU ≈ $3,000/mo — a rounding error against projected licensing
revenue at that scale.

### Tier 4 — Large Language Model
Called only when lower tiers return low confidence or need semantic
interpretation. Infrequent by design.

| Use case | Trigger | What the LLM does | Cost/call |
|---|---|---|---|
| Issue dedup fallback | Fuzzy match confidence below threshold | Determines if two strings describe the same topic, returns yes/no/uncertain with reasoning, surfaces confirmation | $0.001–$0.003 |
| Flyer parse fallback | Vision API low confidence (handwriting, unusual layout) | Interprets raw OCR text, attempts structured extraction | $0.002–$0.005 |
| Custom list photo fallback | Vision API classification below threshold | Interprets visual description, attempts field matching | $0.001–$0.003 |
| Multi-platform URL disambiguation | Pasted URL matches no known platform pattern | Identifies content type and list category, surfaces suggestion | $0.001–$0.002 |

**Cost projection:** conservatively 5% of share actions trigger Tier 4. 10K MAU
× 10 shares/mo = 100K shares → 5K LLM calls @ ~$0.003 ≈ $15/mo. 100K MAU ≈
$150/mo. Well within operating costs at every relevant stage.

## 3. What AI does NOT do
| Function | Why AI isn't involved |
|---|---|
| Feed curation and ranking | Chronological. No engagement algorithm reorders content. |
| Vote aggregation and scoring | Arithmetic — 10 points for first, 1 for tenth. No model adjusts scores. |
| Content moderation | Self-moderation by community weight. No AI content review. |
| Recommendation engine | No recommending what to rank/follow. Discovery is search + social. |
| Trend analysis for public display | Public rankings show raw vote tallies only, no AI-generated narratives. |

Trend analysis across aggregated vote data is a real future AI use case with
revenue potential, but belongs in a separate data-insights product sold to
industry partners — deliberately excluded from the public-facing product.

## 4. Investor framing
**Say:** PeakFeed uses AI surgically — every automated action starts at a direct
API call and escalates to an LLM only when cheaper methods fail. Estimated AI
compute at 1M MAU is under $4,000/month against data-licensing revenue projected
in the millions. The AI that matters is narrow and defensible: reading a
handwritten flyer, catching a duplicate issue entry, parsing an unfamiliar URL —
hard problems no other method handles cleanly.

**Avoid saying:** "AI-powered" as an unqualified headline claim; calling Spotify
playlist creation (two API calls) an AI feature; leading with the Tier 4 data-
licensing story before the product has traction.

**Positioning:** current AI skepticism is about AI replacing human judgment or
surveilling people. PeakFeed's use case is the opposite — it reads a flyer so a
user doesn't have to type, it catches a duplicate before the user has to manage
it. AI in service of human expression, not in place of it.

## 5. Open decisions
| Decision | Status |
|---|---|
| LLM provider: Anthropic, OpenAI, Google Gemini, or open source (Llama, Mistral) | Open. Evaluate when developer engaged. |
| Vision API provider: Google Vision vs AWS Rekognition vs Azure | Open. Google integrates cleanly with existing geocoding/Places usage. |
| Tier 3→4 confidence threshold | Open. Needs testing on real flyer images. |
| Tier 2→4 confidence threshold (issue dedup) | Open. Needs testing on real user input samples. |
| Self-hosted embedding model vs external LLM for issue dedup | Worth evaluating — near-zero cost, eliminates external LLM dependency for the most frequent AI use case. |
| Tier 4 data licensing product scope/timeline | Future state. Do not scope until demonstrable traction. |

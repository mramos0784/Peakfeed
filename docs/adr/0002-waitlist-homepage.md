# ADR 0002 — Waitlist homepage at `/`, split by auth state

*2026-07-17*

## Context
`/` was a pure redirect gate — `redirect(user ? "/lists" : "/login")` — with
no rendering of its own. It sits outside the `(app)` route group added in
ADR 0001, so the nav shell work didn't touch it. Logged-out visitors hitting
the root URL landed straight on the login form, which is fine for a returning
user but wrong for a first-time visitor: there was no page that explained
what PeakFeed is, showed the interactive prototype, or collected interest
before an account exists.

## Decision
**One route, two branches by auth state — not two separate routes.** `/`
still does the same `supabase.auth.getUser()` check. Logged-in users still
get `redirect("/lists")`, byte-for-byte the same as before ADR 0001 and this
change — "land in the app as already wired" per the founder's instruction.
Logged-out users now get the waitlist homepage rendered in place, instead of
being redirected to `/login`. `/login` and `/signup` are untouched and still
reachable directly; a small link on the waitlist hero points at `/login` for
convenience (the founder and early testers otherwise have no way back into
the app from `/` without typing the URL).

**The prototype moved from `reference/` to `public/reference/`, not
duplicated.** The iframe embed needs `peakfeed_v2.html` to be servable at a
real URL, and Next.js only serves static files out of `public/`. Moving
(rather than copying) keeps one source of truth — a duplicate would drift
the moment either copy got edited. This does mean the "static design
prototype" CLAUDE.md refers to now lives under `public/`, alongside the
app's other static assets, rather than in a docs-only folder — worth knowing
if a future session goes looking for it in `reference/` and doesn't find it.

**The prototype embed uses a fixed-size iframe frame, not the prototype's
own phone-mockup CSS.** `peakfeed_v2.html` switches to a bordered
390×844 "phone" look only when its own viewport is ≥601px, and fills edge-
to-edge below that. Since an iframe's internal viewport is whatever CSS
width *we* give the iframe element (not the visitor's actual screen width),
setting the iframe to phone-width (≤390px) makes the prototype always render
in its edge-to-edge mode — so the phone-frame look comes from our own
`.wl-proto-frame` wrapper (border, border-radius, shadow) instead. Simpler
than fighting the prototype's internal media query, and means the same
iframe markup looks right on both mobile and desktop without JS.

**Waitlist submissions go through `/api/waitlist`, never straight to Apps
Script.** The client never sees `WAITLIST_SCRIPT_URL` — it's a server-only
env var (no `NEXT_PUBLIC_` prefix), read only inside the route handler. This
keeps the Apps Script endpoint out of the browser bundle and network tab,
consistent with how `parseLink.ts` already keeps the Anthropic key
server-side. The route validates name/email/city/interests before
forwarding and returns a real error (400/500/502) on any failure — the form
surfaces it, it doesn't fail silently.

## Consequences
- `WAITLIST_SCRIPT_URL` needs to be set in both `.env.local` (local dev) and
  the Vercel dashboard (production) — it won't be picked up from one and not
  the other. Documented in `.env.example`.
- If `/reference/peakfeed_v2.html` is ever referenced by path anywhere else
  in the repo or in conversation, it needs updating to
  `/public/reference/peakfeed_v2.html` (disk path) — the URL path itself
  (`/reference/peakfeed_v2.html`) is unchanged since `public/` is Next's
  static root.
- Interest checkbox keys (`series_location`, `series_featured`,
  `app_early_access`) are validated server-side against a fixed allowlist in
  `src/app/api/waitlist/route.ts`. Adding a 4th interest option means
  updating that allowlist and `WaitlistForm.tsx`'s `INTERESTS` array
  together — they're not derived from a shared source, since there's no
  backend model for "waitlist interest" and adding one for three checkboxes
  would be overbuilding.

## Update, 2026-07-17 — skip the embedded prototype's join screen
The embedded prototype used to open on its own onboarding/join screen (name
+ email + city, "Skip for now — explore the prototype"). Redundant once it's
sitting inside the real waitlist page — a visitor would face two join forms
back to back. Fixed in `public/reference/peakfeed_v2.html`'s `init()`: when
there's no `pf_user` in localStorage it now calls `skipOnboard()`
automatically instead of leaving the onboarding screen active, landing the
visitor straight on the Map screen with the nav bar visible — the same state
a real visitor reaches after clicking "Skip for now" themselves.

Chose auto-skip over deleting the onboarding screen's markup: the prototype
has at least one internal deep link back to it (Profile → Account → "Join
the waitlist ↗" calls `goTo('onboard')`), and other code paths may assume
`#screen-onboard` exists. Deleting it would break those silently. Auto-skip
achieves the same visible outcome — no visitor ever sees the join screen
first — without touching anything downstream. Verified both paths after the
change: fresh load goes straight to Map, and the Profile deep link back to
onboarding still works.

## Update, 2026-07-17 — desktop two-column layout
Below 1024px the page is unchanged: hero, 4-step strip, one-liner, prototype
embed, form, stacked in that order, same CSS as originally shipped. At
1024px and up, `.wl-page` becomes a two-column CSS grid via
`grid-template-areas` — left column stacks hero/steps/one-liner/form (same
DOM order, same components, same copy, no logic changes), right column is
the prototype embed, spanning the full row height so it fills the left
column's height (`align-self: stretch` on `.wl-proto-section`,
`height: 100%` on `.wl-proto-frame`) rather than the fixed 700px it uses on
mobile. Pure CSS restructuring — no JSX/component changes were needed, since
CSS Grid's `grid-area` can re-lay-out elements without touching source
order, which is what makes "mobile untouched, desktop restructured" possible
without forking the markup.

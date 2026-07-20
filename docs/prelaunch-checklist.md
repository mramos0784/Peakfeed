# PeakFeed — Prelaunch Checklist
*Started July 2026. Living document, add to this whenever something gets
deliberately deferred with "figure this out once there's real data" rather
than decided now. This is different from `open-decisions.md`, that file
tracks architecture questions still being worked out; this one tracks
concrete things that must actually happen before public launch.*

## 1. Report review workflow
**Status:** deferred on purpose, revisit once real usage data exists.

The Report action and its storage are being built now (see
`api-integrations-addendum.md`, harmful links section), reports can be
filed and land somewhere from day one. What's not decided yet is the
actual triage process, a dashboard view inside the app, an email
notification the moment one comes in, or a raw table checked manually.

**Why deferred rather than decided now:** the right workflow depends on
real volume and real patterns, guessing at a process before there's a
single real report to look at risks building the wrong thing. Cheap to
revisit later, expensive to build wrong now.

**Trigger to resolve this, before it can be called done:** once there's
enough real user activity that reports could plausibly start coming in,
this needs an actual answer, not "we'll figure it out," before public
launch. Don't let this be the thing that's still unresolved on launch day.

## (add future items below as they come up)

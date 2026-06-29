---
name: Clean live-session map
description: Why the main map intentionally shows no historical coverage, only the active walk.
---

# Main map shows only the live session

The main Map screen (`components/MapScreen.native.tsx`) renders ONLY the current
active-session track (blue polyline), priority areas, and draw mode. It does NOT
render historical coverage / heat-map polylines.

**Why:** Users found it confusing that, with no walk active, the previous walk's
route was still drawn all over the map (looked like an active/recent session).
When given the choice the user explicitly picked "a completely clean map — no
past routes at all; coverage history lives only in the History tab."

**How to apply:** Do not re-add a coverage heat-map (or group-coverage overlay,
Me/Group toggle, date filter) to the live map. Past routes are viewable in
History → tap a walk → `SessionDetail` already draws that walk's route with
start/end markers. If group-coverage comparison is wanted later, build it on a
dedicated screen/tab, not the live map.

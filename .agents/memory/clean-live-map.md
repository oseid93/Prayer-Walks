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

**How to apply:** The Me/Group toggle on the main map is wired to `/api/groups`
(the original groups system, 91+ memberships). Do NOT wire it to `/api/my-teams`
or `/api/teams/:id/coverage` — that is the newer teams system with very few members
and will show empty coverage for almost everyone. Personal ("Me") mode is the default
clean map; group coverage only renders when the user explicitly switches to "Group" mode.

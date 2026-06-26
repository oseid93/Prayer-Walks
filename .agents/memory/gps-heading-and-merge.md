---
name: GPS heading source & background-point merge
description: Durable rules for walk-tracking heading source and how to merge background points without losing locked-screen coverage
---

# Walk tracking: heading source & background merge

## Heading must be direction-of-travel, never the compass
**Rule:** orient the navigation camera from point-to-point travel bearing only.
Do NOT feed `Location.watchHeadingAsync` (magnetometer) into the shared heading.
**Why:** the compass reports where the *phone* points, fires constantly, and
overwrites the travel bearing — so the course-up map spins to the wrong direction
when the phone is in a hand/pocket. This was the real cause of user reports that
tracking "goes the wrong direction" and the route appears to loop (a spinning map
makes a straight route swing on screen).
**How to apply:** rely on the movement-gated bearing already computed in the
foreground watch (guarded by a ~2 m threshold, which also kills stationary jitter).

## Merging background points must NOT be append-only
**Rule:** when draining background-buffered points into the live route, merge and
**full chronological sort** — do not keep only points newer than the last point.
**Why:** an append-only "tail" filter looks like it prevents the live polyline
reordering, but it permanently drops a contiguous locked-screen block whenever a
foreground fix lands during the app-return race (the buffer is cleared up front).
That loses exactly the background segment the feature exists to record. Telemetry
shows merges are almost always pure duplicates (`merged:0`), so re-sorting is
rarely the loop cause anyway — not worth the coverage-loss regression.
**How to apply:** keep `[...prev, ...newPts].sort(by timestamp)`; dedupe by
timestamp before merging. If distance double-count ever matters, fix it without
switching to append-only.

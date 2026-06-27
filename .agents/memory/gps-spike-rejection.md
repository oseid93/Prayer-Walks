---
name: GPS spike / route-derailment rejection
description: Why StreetCover rejects GPS outliers by implied speed (not distance) and how it's wired across foreground/background/finalize.
---

StreetCover records RAW GPS points and draws them directly — there is NO road-snapping/map-matching, so "on-road vs off-road" is not a code distinction. The only route-"derailment" vector is GPS outlier spikes.

Rule: reject a fix as a spike when its IMPLIED SPEED from the last accepted fix exceeds `MAX_PLAUSIBLE_SPEED_KMH` (120). Speed-based, NOT distance-based.

**Why:** a real spike covers a huge distance in a tiny time (impossible speed); a legitimate large jump after a GPS gap (tunnel, reacquisition, locked screen) covers the same distance over a long time (plausible speed). A pure distance cap would wrongly drop the legit large-gap jump. `dt <= 0` with non-zero distance => Infinity speed => reject (also catches same-timestamp / different-location contradictions).

**How to apply:** the decision lives in `lib/tracking-math.ts` (`impliedSpeedKmh` / `isGpsSpike` / `foregroundStep`'s `rejected` field; `mergeTrackPoints` and `finalizeFromPoints` use the same lastKept-walk). When a fix is rejected the caller must NOT advance its "previous location" / last-fix-time, so the next fix is judged against the last GOOD anchor (self-corrects, no lockout at walking pace). Keep foreground (native + web watches), background merge, and finalize paths consistent. Do NOT move the live map marker to a rejected fix (native/web parity).

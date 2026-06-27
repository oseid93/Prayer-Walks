// Pure, dependency-free tracking math.
//
// This module deliberately imports nothing from React, expo-location, or any
// native module so it can be unit-tested in plain Node (BDD/TDD). The tracking
// context imports these helpers so the tests exercise the *real* code path used
// while a walk is recorded — not a copy.

export interface GeoPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy?: number | null;
}

// Foreground movement gate: ignore sub-2-metre jitter so a stationary phone
// doesn't accumulate distance or spin the heading.
export const MOVEMENT_GATE_KM = 0.002;

// Upper movement gate: the fastest a fix can plausibly move from the previous
// one before it is treated as a GPS spike (a "teleport" that would derail the
// route and inflate distance). 120 km/h is far above any walking/running pace
// yet well below typical spike speeds (a glitch jumps hundreds of metres in
// ~1 s, i.e. hundreds of km/h). A genuinely distant fix reached over a long
// time gap (tunnel, reacquisition) has a LOW implied speed and is kept.
export const MAX_PLAUSIBLE_SPEED_KMH = 120;

// Great-circle distance between two coordinates, in kilometres.
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Implied speed (km/h) to cover `distanceKm` in `dtSeconds`. Zero distance is
// always 0 (no movement, never a spike); a non-zero move with no elapsed time
// is treated as infinitely fast (implausible) so it can be rejected.
export function impliedSpeedKmh(distanceKm: number, dtSeconds: number): number {
  if (distanceKm <= 0) return 0;
  if (dtSeconds <= 0) return Infinity;
  return distanceKm / (dtSeconds / 3600);
}

// Whether `point` is an implausible GPS spike relative to `prev`, judged by the
// speed required to get there in `dtSeconds`. With no previous fix the point is
// never a spike (nothing to compare against).
export function isGpsSpike(
  prev: { latitude: number; longitude: number } | null,
  point: { latitude: number; longitude: number },
  dtSeconds: number,
  maxSpeedKmh: number = MAX_PLAUSIBLE_SPEED_KMH,
): boolean {
  if (!prev) return false;
  const d = haversineDistance(
    prev.latitude,
    prev.longitude,
    point.latitude,
    point.longitude,
  );
  return impliedSpeedKmh(d, dtSeconds) > maxSpeedKmh;
}

// Initial bearing (direction of travel) from point 1 to point 2, in degrees
// clockwise from true north, normalised to [0, 360).
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

export interface ForegroundStep {
  // Distance to add to the running total (km). 0 when the move is below the gate.
  distanceDelta: number;
  // New travel-direction heading, or null when there was no qualifying move.
  heading: number | null;
  // Whether the point cleared the movement gate.
  moved: boolean;
  // Whether the point was discarded as an implausible GPS spike. When true the
  // caller must NOT advance its "previous location" to this point, so the next
  // fix is compared against the last *good* location rather than the spike.
  rejected: boolean;
}

// Decide how a single foreground GPS fix updates distance and heading, applying
// the movement gate. `prev` is the last *gated* location (null on the first fix).
//
// When `dtSeconds` (seconds since the previous gated fix) is supplied, the point
// is first checked against the upper speed gate: an implausibly fast jump is
// rejected as a GPS spike so it can't derail the route or inflate distance.
export function foregroundStep(
  prev: { latitude: number; longitude: number } | null,
  point: { latitude: number; longitude: number },
  dtSeconds?: number,
  maxSpeedKmh: number = MAX_PLAUSIBLE_SPEED_KMH,
): ForegroundStep {
  if (!prev) return { distanceDelta: 0, heading: null, moved: false, rejected: false };
  const d = haversineDistance(
    prev.latitude,
    prev.longitude,
    point.latitude,
    point.longitude,
  );
  if (dtSeconds !== undefined && impliedSpeedKmh(d, dtSeconds) > maxSpeedKmh) {
    return { distanceDelta: 0, heading: null, moved: false, rejected: true };
  }
  if (d > MOVEMENT_GATE_KM) {
    return {
      distanceDelta: d,
      heading: calculateBearing(
        prev.latitude,
        prev.longitude,
        point.latitude,
        point.longitude,
      ),
      moved: true,
      rejected: false,
    };
  }
  return { distanceDelta: 0, heading: null, moved: false, rejected: false };
}

export interface MergeResult<T extends GeoPoint> {
  // The full route after merging, in chronological order.
  merged: T[];
  // Distance contributed by the newly inserted points (km).
  extraDistance: number;
  // Travel-direction heading from the last two points, or null if < 2 points.
  heading: number | null;
  // Points that were actually new (not timestamp duplicates of existing ones).
  added: T[];
}

// Merge background-buffered points into the existing route.
//
// Critical behaviours (regression-guarded by tests):
//   1. Duplicate timestamps already present in `prev` are discarded.
//   2. The result is a FULL chronological sort, never an append-only tail, so a
//      contiguous block of points captured while the screen was locked is kept
//      and inserted in its correct position even if a fresh foreground fix has
//      already landed after the app returns to the foreground.
//   3. extraDistance sums each new point's hop from its chronological
//      predecessor, giving a single consistent distance model.
export function mergeTrackPoints<T extends GeoPoint>(
  prev: T[],
  incoming: T[],
): MergeResult<T> {
  const existingTs = new Set(prev.map((p) => p.timestamp));
  const added = incoming.filter((p) => !existingTs.has(p.timestamp));

  if (added.length === 0) {
    return { merged: prev, extraDistance: 0, heading: null, added: [] };
  }

  const prevTs = new Set(prev.map((p) => p.timestamp));
  const combined = [...prev, ...added].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Walk the chronological sequence keeping the last *trusted* point. Existing
  // (already-persisted) points are always kept; a newly-incoming point is
  // dropped as a GPS spike if the speed from the last kept point is implausible,
  // so a single bad background fix can't derail the route or inflate distance.
  const merged: T[] = [];
  const keptAdded: T[] = [];
  let extraDistance = 0;
  let lastKept: T | null = null;
  for (const pt of combined) {
    const isExisting = prevTs.has(pt.timestamp);
    if (lastKept && !isExisting) {
      const dt =
        (new Date(pt.timestamp).getTime() -
          new Date(lastKept.timestamp).getTime()) /
        1000;
      if (isGpsSpike(lastKept, pt, dt)) {
        continue;
      }
      extraDistance += haversineDistance(
        lastKept.latitude,
        lastKept.longitude,
        pt.latitude,
        pt.longitude,
      );
    }
    merged.push(pt);
    if (!isExisting) keptAdded.push(pt);
    lastKept = pt;
  }

  let heading: number | null = null;
  if (merged.length >= 2) {
    const last = merged[merged.length - 1];
    const secondLast = merged[merged.length - 2];
    heading = calculateBearing(
      secondLast.latitude,
      secondLast.longitude,
      last.latitude,
      last.longitude,
    );
  }

  return { merged, extraDistance, heading, added: keptAdded };
}

// Seconds elapsed since a walk's start, used to drive the live session timer.
// Faithful to the interval that ticks the on-screen clock: a plain floor of the
// millisecond delta.
export function elapsedSeconds(startTimeMs: number, nowMs: number): number {
  return Math.floor((nowMs - startTimeMs) / 1000);
}

export interface TimedPoint {
  latitude: number;
  longitude: number;
  timestamp: string | number | Date;
}

export interface FinalizedSession {
  // Total route distance (km) summed over chronologically-ordered hops.
  distance: number;
  // Wall-clock duration (seconds) between the first and last point.
  duration: number;
  // Number of points considered.
  count: number;
}

// Reconstruct a session's distance and duration purely from its recorded points.
//
// Used by cold-start recovery: when iOS suspends/terminates the app mid-walk the
// in-memory totals are lost, so on next launch the session is finalized from its
// persisted points instead. Points are sorted by timestamp first so an
// out-of-order buffer (e.g. a locked-screen block flushed late) still yields the
// correct distance and duration rather than a straight line.
export function finalizeFromPoints(points: TimedPoint[]): FinalizedSession {
  const sorted = [...points].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  // Sum hops from the last *trusted* point, skipping any hop whose implied speed
  // is impossible (a GPS spike that slipped into the persisted points) so
  // recovered distance isn't inflated by a teleport.
  let distance = 0;
  let lastKept: TimedPoint | null = sorted.length > 0 ? sorted[0] : null;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const dt =
      (new Date(cur.timestamp).getTime() -
        new Date(lastKept!.timestamp).getTime()) /
      1000;
    if (isGpsSpike(lastKept, cur, dt)) {
      continue;
    }
    distance += haversineDistance(
      lastKept!.latitude,
      lastKept!.longitude,
      cur.latitude,
      cur.longitude,
    );
    lastKept = cur;
  }
  let duration = 0;
  if (sorted.length >= 2) {
    duration = Math.max(
      0,
      Math.floor(
        (new Date(sorted[sorted.length - 1].timestamp).getTime() -
          new Date(sorted[0].timestamp).getTime()) /
          1000,
      ),
    );
  }
  return { distance, duration, count: sorted.length };
}

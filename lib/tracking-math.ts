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
}

// Decide how a single foreground GPS fix updates distance and heading, applying
// the movement gate. `prev` is the last *gated* location (null on the first fix).
export function foregroundStep(
  prev: { latitude: number; longitude: number } | null,
  point: { latitude: number; longitude: number },
): ForegroundStep {
  if (!prev) return { distanceDelta: 0, heading: null, moved: false };
  const d = haversineDistance(
    prev.latitude,
    prev.longitude,
    point.latitude,
    point.longitude,
  );
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
    };
  }
  return { distanceDelta: 0, heading: null, moved: false };
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

  const merged = [...prev, ...added].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let extraDistance = 0;
  for (const pt of added) {
    const idx = merged.findIndex((p) => p.timestamp === pt.timestamp);
    if (idx > 0) {
      const before = merged[idx - 1];
      extraDistance += haversineDistance(
        before.latitude,
        before.longitude,
        pt.latitude,
        pt.longitude,
      );
    }
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

  return { merged, extraDistance, heading, added };
}

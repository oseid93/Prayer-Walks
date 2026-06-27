import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  haversineDistance,
  calculateBearing,
  foregroundStep,
  mergeTrackPoints,
  MOVEMENT_GATE_KM,
  type GeoPoint,
} from "../tracking-math";

// Helpers to make the GPS scenarios read like real walks.
// ~0.00001 degrees of latitude is ~1.11 metres.
const METER_LAT = 1 / 111_320; // degrees of latitude per metre

function pt(
  latitude: number,
  longitude: number,
  secondsFromStart: number,
): GeoPoint {
  return {
    latitude,
    longitude,
    timestamp: new Date(1_700_000_000_000 + secondsFromStart * 1000).toISOString(),
    accuracy: 5,
  };
}

describe("Feature: measuring how far a walk covered", () => {
  it("Given two points ~111m apart, When measured, Then distance is ~0.111km", () => {
    // 0.001 degrees of latitude ~= 111.32 m
    const d = haversineDistance(40.0, -73.0, 40.001, -73.0);
    assert.ok(Math.abs(d - 0.11132) < 0.0005, `expected ~0.111km, got ${d}`);
  });

  it("Given the same point twice, When measured, Then distance is 0", () => {
    assert.equal(haversineDistance(40, -73, 40, -73), 0);
  });

  it("Given a known city pair (approx), When measured, Then it is in a sane range", () => {
    // London -> Paris is ~343 km. Allow a generous band.
    const d = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    assert.ok(d > 300 && d < 380, `expected ~343km, got ${d}`);
  });
});

describe("Feature: heading reflects direction of travel (the wrong-direction fix)", () => {
  // These scenarios encode the fix: heading comes from point-to-point travel,
  // NOT the magnetometer compass. Walking a direction always yields that
  // direction regardless of how the phone is physically held.
  it("Given the user walks north, Then heading is ~0deg", () => {
    const b = calculateBearing(40.0, -73.0, 40.001, -73.0);
    assert.ok(b < 1 || b > 359, `expected ~0deg (north), got ${b}`);
  });

  it("Given the user walks east, Then heading is ~90deg", () => {
    const b = calculateBearing(40.0, -73.0, 40.0, -72.999);
    assert.ok(Math.abs(b - 90) < 1, `expected ~90deg (east), got ${b}`);
  });

  it("Given the user walks south, Then heading is ~180deg", () => {
    const b = calculateBearing(40.0, -73.0, 39.999, -73.0);
    assert.ok(Math.abs(b - 180) < 1, `expected ~180deg (south), got ${b}`);
  });

  it("Given the user walks west, Then heading is ~270deg", () => {
    const b = calculateBearing(40.0, -73.0, 40.0, -73.001);
    assert.ok(Math.abs(b - 270) < 1, `expected ~270deg (west), got ${b}`);
  });

  it("Given any travel direction, Then heading is normalised to [0,360)", () => {
    const b = calculateBearing(40.0, -73.0, 39.999, -73.001); // south-west
    assert.ok(b >= 0 && b < 360);
    assert.ok(b > 180 && b < 270, `expected south-west quadrant, got ${b}`);
  });
});

describe("Feature: standing still must not move the route or spin the map", () => {
  it("Given the very first fix (no previous), Then nothing is added", () => {
    const step = foregroundStep(null, { latitude: 40, longitude: -73 });
    assert.deepEqual(step, {
      distanceDelta: 0,
      heading: null,
      moved: false,
      rejected: false,
    });
  });

  it("Given GPS jitter below the ~2m gate, Then distance and heading are unchanged", () => {
    const prev = { latitude: 40.0, longitude: -73.0 };
    // ~1 metre of jitter, under the gate
    const jittered = { latitude: 40.0 + METER_LAT * 1, longitude: -73.0 };
    assert.ok(
      haversineDistance(prev.latitude, prev.longitude, jittered.latitude, jittered.longitude) <
        MOVEMENT_GATE_KM,
    );
    const step = foregroundStep(prev, jittered);
    assert.equal(step.moved, false);
    assert.equal(step.distanceDelta, 0);
    assert.equal(step.heading, null);
  });

  it("Given a real ~5m step, Then distance accrues and heading updates", () => {
    const prev = { latitude: 40.0, longitude: -73.0 };
    const moved = { latitude: 40.0 + METER_LAT * 5, longitude: -73.0 };
    const step = foregroundStep(prev, moved);
    assert.equal(step.moved, true);
    assert.ok(step.distanceDelta > 0.004 && step.distanceDelta < 0.006);
    assert.ok(step.heading !== null && (step.heading < 1 || step.heading > 359)); // north
  });

  it("Boundary: a move just over the ~2m gate counts; just under does not (strict >)", () => {
    const prev = { latitude: 40.0, longitude: -73.0 };
    const justOver = { latitude: 40.0 + METER_LAT * 2.5, longitude: -73.0 };
    const justUnder = { latitude: 40.0 + METER_LAT * 1.5, longitude: -73.0 };
    const dOver = haversineDistance(prev.latitude, prev.longitude, justOver.latitude, justOver.longitude);
    const dUnder = haversineDistance(prev.latitude, prev.longitude, justUnder.latitude, justUnder.longitude);
    // The two points truly straddle the gate.
    assert.ok(dUnder < MOVEMENT_GATE_KM, `under should be < gate, got ${dUnder}`);
    assert.ok(dOver > MOVEMENT_GATE_KM, `over should be > gate, got ${dOver}`);
    assert.equal(foregroundStep(prev, justUnder).moved, false);
    assert.equal(foregroundStep(prev, justOver).moved, true);
  });
});

describe("Feature: merging locked-screen (background) points into the live route", () => {
  it("Given background points duplicate existing timestamps, Then duplicates are discarded", () => {
    const prev = [pt(40.0, -73.0, 0), pt(40.001, -73.0, 10)];
    const incoming = [pt(40.001, -73.0, 10), pt(40.002, -73.0, 20)]; // first is a dup ts
    const res = mergeTrackPoints(prev, incoming);
    assert.equal(res.added.length, 1);
    assert.equal(res.added[0].timestamp, pt(40.002, -73.0, 20).timestamp);
    assert.equal(res.merged.length, 3);
  });

  it("Given identical buffered points, When merged, Then route is unchanged and no distance added", () => {
    const prev = [pt(40.0, -73.0, 0), pt(40.001, -73.0, 10)];
    const res = mergeTrackPoints(prev, [pt(40.0, -73.0, 0)]);
    assert.equal(res.added.length, 0);
    assert.equal(res.extraDistance, 0);
    assert.equal(res.heading, null);
    assert.equal(res.merged, prev); // same reference, no work done
  });

  it("Given the result, Then points are in chronological order", () => {
    const prev = [pt(40.0, -73.0, 0), pt(40.003, -73.0, 30)];
    // a locked-screen block that belongs BETWEEN the two existing points
    const incoming = [pt(40.001, -73.0, 10), pt(40.002, -73.0, 20)];
    const res = mergeTrackPoints(prev, incoming);
    const times = res.merged.map((p) => new Date(p.timestamp).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    assert.deepEqual(times, sorted);
    assert.equal(res.merged.length, 4);
  });

  it("REGRESSION: Given a fresh foreground fix already landed after unlock, When the locked-screen block (older timestamps) is merged, Then those points are KEPT, not dropped", () => {
    // This is the exact race that an append-only merge got wrong: the buffer
    // holds points captured while the screen was locked (t=10..30), but a fresh
    // foreground fix at t=40 has already been committed during app-return.
    const prev = [pt(40.0, -73.0, 0), pt(40.004, -73.0, 40)];
    const lockedBlock = [
      pt(40.001, -73.0, 10),
      pt(40.002, -73.0, 20),
      pt(40.003, -73.0, 30),
    ];
    const res = mergeTrackPoints(prev, lockedBlock);
    // All three locked-screen points survive.
    assert.equal(res.added.length, 3);
    assert.equal(res.merged.length, 5);
    // And they are slotted into their correct chronological position.
    const times = res.merged.map((p) => new Date(p.timestamp).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it("Given a straight northbound locked block, Then extra distance ~= the gap walked and heading stays north", () => {
    const prev = [pt(40.0, -73.0, 0)];
    const block = [
      pt(40.0 + METER_LAT * 10, -73.0, 10),
      pt(40.0 + METER_LAT * 20, -73.0, 20),
    ];
    const res = mergeTrackPoints(prev, block);
    // ~20 m total
    assert.ok(res.extraDistance > 0.018 && res.extraDistance < 0.022, `got ${res.extraDistance}`);
    assert.ok(res.heading !== null && (res.heading < 1 || res.heading > 359));
  });

  it("Given two incoming points sharing a timestamp at different coords, Then the contradictory second one is dropped as an impossible (zero-time) jump", () => {
    const prev = [pt(40.0, -73.0, 0)];
    // Two distinct incoming points that share a timestamp (t=10). Being in two
    // places at the same instant is physically impossible (infinite implied
    // speed), so the spike guard keeps only the first.
    const a = pt(40.001, -73.0, 10);
    const b = { ...pt(40.002, -73.0, 10) }; // same ts as `a`, different coords
    const res = mergeTrackPoints(prev, [a, b]);
    assert.equal(res.added.length, 1);
    assert.equal(res.merged.length, 2);
    assert.ok(
      !res.merged.some((p) => p.latitude === b.latitude),
      "the contradictory same-timestamp point must be dropped",
    );
  });
});

describe("Feature: the map heading must never be driven by the phone compass", () => {
  // Integration invariant for the wrong-direction fix: heading is derived from
  // direction of travel only. Reintroducing the magnetometer compass
  // subscription (Location.watchHeadingAsync) is what made the map spin to the
  // wrong direction, so this test fails loudly if it ever comes back.
  const here = dirname(fileURLToPath(import.meta.url));
  const trackingContextSrc = readFileSync(
    join(here, "..", "tracking-context.tsx"),
    "utf8",
  );

  it("Given the tracking context source, Then it does NOT subscribe to watchHeadingAsync", () => {
    assert.ok(
      !/watchHeadingAsync\s*\(/.test(trackingContextSrc),
      "tracking-context.tsx must not call Location.watchHeadingAsync — heading must come from travel bearing only",
    );
  });

  it("Given the tracking context source, Then heading is computed via calculateBearing/foregroundStep", () => {
    assert.ok(
      /calculateBearing|foregroundStep|mergeTrackPoints/.test(trackingContextSrc),
      "heading should be derived from the travel-bearing helpers",
    );
  });
});

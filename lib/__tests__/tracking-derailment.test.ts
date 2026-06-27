import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  foregroundStep,
  mergeTrackPoints,
  finalizeFromPoints,
  impliedSpeedKmh,
  isGpsSpike,
  MAX_PLAUSIBLE_SPEED_KMH,
  type GeoPoint,
} from "../tracking-math";

// ~1 metre expressed in degrees of latitude (good enough near the equator-ish
// mid-latitudes used here). Lets the scenarios read in metres.
const METER_LAT = 1 / 111_320;
const BASE_LAT = 40.0;
const BASE_LNG = -73.0;

// A point `metresNorth` of the base origin, stamped `secondsFromStart` in.
function pt(
  metresNorth: number,
  secondsFromStart: number,
  metresEast = 0,
): GeoPoint {
  return {
    latitude: BASE_LAT + metresNorth * METER_LAT,
    longitude:
      BASE_LNG +
      (metresEast * METER_LAT) / Math.cos((BASE_LAT * Math.PI) / 180),
    timestamp: new Date(
      1_700_000_000_000 + secondsFromStart * 1000,
    ).toISOString(),
    accuracy: 5,
  };
}

function loc(metresNorth: number, metresEast = 0) {
  return {
    latitude: BASE_LAT + metresNorth * METER_LAT,
    longitude:
      BASE_LNG +
      (metresEast * METER_LAT) / Math.cos((BASE_LAT * Math.PI) / 180),
  };
}

describe("Feature: implied speed between two GPS fixes", () => {
  it("Given no movement, When measured, Then implied speed is 0 (never a spike)", () => {
    assert.equal(impliedSpeedKmh(0, 2), 0);
  });

  it("Given a real move over real time, When measured, Then speed is plausible", () => {
    // 5 m in 3 s ~= 6 km/h (a brisk walk).
    const kmh = impliedSpeedKmh(0.005, 3);
    assert.ok(Math.abs(kmh - 6) < 0.5, `expected ~6 km/h, got ${kmh}`);
  });

  it("Given a move with no elapsed time, When measured, Then speed is Infinity (implausible)", () => {
    assert.equal(impliedSpeedKmh(0.005, 0), Infinity);
  });
});

describe("Feature: rejecting GPS spikes so the route can't derail", () => {
  it("Given no previous fix, When checked, Then a point is never a spike", () => {
    assert.equal(isGpsSpike(null, loc(500), 2), false);
  });

  it("Given a sudden 500 m jump in 2 s, When checked, Then it is a spike", () => {
    assert.equal(isGpsSpike(loc(0), loc(500), 2), true);
  });

  it("Given the same 500 m reached over a 5 min GPS gap, When checked, Then it is NOT a spike", () => {
    // Same distance, but plausible over a long reacquisition gap (~6 km/h).
    assert.equal(isGpsSpike(loc(0), loc(500), 300), false);
  });
});

describe("Feature: foregroundStep applies the speed gate", () => {
  it("Given a normal walking step, When stepped, Then it is accepted and adds distance", () => {
    const step = foregroundStep(loc(0), loc(5), 3);
    assert.equal(step.rejected, false);
    assert.equal(step.moved, true);
    assert.ok(step.distanceDelta > 0, "expected distance to accrue");
  });

  it("Given a GPS spike (500 m in 2 s), When stepped, Then it is rejected and adds nothing", () => {
    const step = foregroundStep(loc(0), loc(500), 2);
    assert.equal(step.rejected, true);
    assert.equal(step.moved, false);
    assert.equal(step.distanceDelta, 0);
    assert.equal(step.heading, null);
  });

  it("Given a legit large jump after a long gap, When stepped, Then it is kept", () => {
    const step = foregroundStep(loc(0), loc(500), 300);
    assert.equal(step.rejected, false);
    assert.equal(step.moved, true);
    assert.ok(Math.abs(step.distanceDelta - 0.5) < 0.01);
  });

  it("Given no time delta supplied, When stepped, Then spikes are NOT rejected (back-compat)", () => {
    // Without dt the speed gate can't apply; the move still clears the jitter gate.
    const step = foregroundStep(loc(0), loc(500));
    assert.equal(step.rejected, false);
    assert.equal(step.moved, true);
  });

  it("Given a fix just under the speed cap, When stepped, Then it is accepted", () => {
    // 60 m in 2 s ~= 108 km/h, just below the 120 km/h cap.
    const step = foregroundStep(loc(0), loc(60), 2);
    assert.ok(impliedSpeedKmh(0.06, 2) < MAX_PLAUSIBLE_SPEED_KMH);
    assert.equal(step.rejected, false);
    assert.equal(step.moved, true);
  });

  it("Given a fix just over the speed cap, When stepped, Then it is rejected", () => {
    // 80 m in 2 s ~= 144 km/h, above the 120 km/h cap.
    const step = foregroundStep(loc(0), loc(80), 2);
    assert.ok(impliedSpeedKmh(0.08, 2) > MAX_PLAUSIBLE_SPEED_KMH);
    assert.equal(step.rejected, true);
  });
});

describe("Feature: normal walks (on-road and off-road) are never wrongly rejected", () => {
  it("Given a straight on-road stretch, When walked, Then every step is accepted", () => {
    // Steady ~5 m every 3 s straight north.
    let prev = loc(0);
    let prevT = 0;
    for (let i = 1; i <= 20; i++) {
      const here = loc(i * 5);
      const t = i * 3;
      const step = foregroundStep(prev, here, t - prevT);
      assert.equal(step.rejected, false, `step ${i} wrongly rejected`);
      assert.equal(step.moved, true, `step ${i} should count as movement`);
      prev = here;
      prevT = t;
    }
  });

  it("Given an off-road zig-zag, When walked, Then erratic-but-plausible turns are kept", () => {
    // Sharp direction changes but realistic per-step distances (~4-6 m / 3 s).
    const path: Array<[number, number]> = [
      [0, 0],
      [5, 0],
      [5, 5],
      [9, 2],
      [9, 8],
      [4, 8],
      [4, 14],
    ];
    let prev = loc(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      const here = loc(path[i][0], path[i][1]);
      const step = foregroundStep(prev, here, 3);
      assert.equal(step.rejected, false, `turn ${i} wrongly rejected`);
      prev = here;
    }
  });
});

describe("Feature: background merge drops spikes", () => {
  it("Given a spike among background points, When merged, Then it is dropped and distance stays small", () => {
    const added = [
      pt(0, 0),
      pt(5, 3), // +5 m in 3 s — normal
      pt(5000, 5), // +~5 km in 2 s — SPIKE
      pt(8, 8), // back near the real path
    ];
    const result = mergeTrackPoints([], added);
    assert.equal(result.merged.length, 3, "spike should be dropped from merged");
    const spikeTs = added[2].timestamp;
    assert.ok(
      !result.merged.some((p) => p.timestamp === spikeTs),
      "spike point must not appear in the merged route",
    );
    assert.ok(
      result.extraDistance < 0.05,
      `distance should stay small, got ${result.extraDistance} km`,
    );
  });

  it("Given a plausible large gap, When merged, Then the distant point is kept", () => {
    const added = [pt(0, 0), pt(500, 300)]; // 500 m over 5 min — plausible
    const result = mergeTrackPoints([], added);
    assert.equal(result.merged.length, 2);
    assert.ok(Math.abs(result.extraDistance - 0.5) < 0.02);
  });
});

describe("Feature: recovery from persisted points ignores spikes", () => {
  it("Given a spike in persisted points, When finalized, Then distance isn't inflated", () => {
    const points = [
      pt(0, 0),
      pt(10, 5), // +10 m in 5 s
      pt(5000, 7), // +~5 km in 2 s — SPIKE
      pt(18, 12), // back near the real path
    ];
    const { distance, count } = finalizeFromPoints(points);
    assert.equal(count, 4, "all points are still counted");
    assert.ok(
      distance < 0.05,
      `recovered distance should ignore the spike, got ${distance} km`,
    );
  });
});

/**
 * Tracking context STATE-WIRING tests (timer, sync buffer, cold-start recovery).
 *
 * The tracking context (lib/tracking-context.tsx) can't run in plain Node (it
 * depends on React + expo-location + AsyncStorage), so the state-transition
 * logic it wires up has been extracted into pure modules that the context
 * imports. These tests exercise that *real* logic in Given/When/Then style:
 *   - elapsedSeconds  -> the live session timer tick
 *   - drainBuffer / requeueFailed -> the server-sync points buffer
 *   - finalizeFromPoints -> cold-start recovery (rebuild distance/duration)
 *
 * Run: node --import tsx --test lib/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { elapsedSeconds, finalizeFromPoints } from "@/lib/tracking-math";
import { drainBuffer, requeueFailed } from "@/lib/tracking-buffer";

// ─── Session timer ──────────────────────────────────────────────────────────

describe("Session timer (elapsedSeconds)", () => {
  it("Given a start time, When 65s have passed, Then it reports whole minutes+seconds", () => {
    const start = 1_000_000;
    assert.equal(elapsedSeconds(start, start + 65_000), 65);
  });

  it("Given sub-second elapsed, When ticking, Then it floors to whole seconds (no flicker)", () => {
    const start = 0;
    assert.equal(elapsedSeconds(start, 1_999), 1);
    assert.equal(elapsedSeconds(start, 999), 0);
  });

  it("Given the exact start instant, When ticking, Then elapsed is 0", () => {
    assert.equal(elapsedSeconds(5_000, 5_000), 0);
  });
});

// ─── Sync buffer ────────────────────────────────────────────────────────────

describe("Sync buffer (drain / requeue)", () => {
  it("Given buffered points, When drained, Then a snapshot is taken and the buffer is emptied", () => {
    const buffer = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const { toSync, remaining } = drainBuffer(buffer);
    assert.deepEqual(
      toSync.map((p) => p.n),
      [1, 2, 3],
    );
    assert.deepEqual(remaining, []);
    // The snapshot must be a copy, not an alias of the original buffer.
    assert.notEqual(toSync, buffer);
  });

  it("Given a failed flush, When points recorded mid-flight, Then the failed batch is retried FIRST, in order", () => {
    // Given: [A,B] were in-flight and failed; [C] arrived while the request ran
    const failed = ["A", "B"];
    const arrivedDuringFlight = ["C"];
    // When: we requeue the failed batch
    const next = requeueFailed(failed, arrivedDuringFlight);
    // Then: chronological order is preserved — nothing lost, nothing reordered
    assert.deepEqual(next, ["A", "B", "C"]);
  });

  it("Given an empty buffer, When drained, Then nothing to sync", () => {
    const { toSync, remaining } = drainBuffer<number>([]);
    assert.deepEqual(toSync, []);
    assert.deepEqual(remaining, []);
  });
});

// ─── Cold-start recovery ────────────────────────────────────────────────────

describe("Cold-start recovery (finalizeFromPoints)", () => {
  // Two points ~111m apart north-south (0.001 deg latitude ≈ 111m), 60s apart.
  const p = (lat: number, lon: number, tsSeconds: number) => ({
    latitude: lat,
    longitude: lon,
    timestamp: new Date(tsSeconds * 1000).toISOString(),
  });

  it("Given persisted points, When finalizing, Then distance and duration are rebuilt from them", () => {
    const result = finalizeFromPoints([p(40.0, -73.0, 0), p(40.001, -73.0, 60)]);
    assert.equal(result.count, 2);
    assert.equal(result.duration, 60);
    // ~0.111 km between the two points.
    assert.ok(Math.abs(result.distance - 0.111) < 0.01, `distance was ${result.distance}`);
  });

  it("Given out-of-order points (a late locked-screen block), When finalizing, Then they are sorted by time first", () => {
    // The middle point arrives last in the array but belongs in the middle by time.
    const unordered = [
      p(40.0, -73.0, 0),
      p(40.002, -73.0, 120),
      p(40.001, -73.0, 60), // out of order in the array
    ];
    const result = finalizeFromPoints(unordered);
    assert.equal(result.duration, 120);
    // Sorted, the route is three colinear hops ≈ 0.222 km total, NOT a long
    // straight line from start->end->middle that an unsorted sum would give.
    assert.ok(Math.abs(result.distance - 0.222) < 0.02, `distance was ${result.distance}`);
  });

  it("Given a single point, When finalizing, Then distance and duration are zero", () => {
    const result = finalizeFromPoints([p(40.0, -73.0, 0)]);
    assert.equal(result.count, 1);
    assert.equal(result.distance, 0);
    assert.equal(result.duration, 0);
  });

  it("Given no points, When finalizing, Then it returns an empty session safely", () => {
    const result = finalizeFromPoints([]);
    assert.deepEqual(result, { distance: 0, duration: 0, count: 0 });
  });
});

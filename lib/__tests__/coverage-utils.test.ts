import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getVisitColor,
  getVisitWidth,
  buildCoveragePolylines,
  formatDuration,
  formatDistance,
} from "../coverage-utils";

describe("Feature: heat-map colour reflects how often a street was walked", () => {
  it("Given 1 visit, Then it is green (cold)", () => {
    assert.equal(getVisitColor(1), "#4CD964");
  });
  it("Given 6+ visits, Then it is red (hot)", () => {
    assert.equal(getVisitColor(6), "#FF3B30");
    assert.equal(getVisitColor(20), "#FF3B30");
  });
  it("Given more visits, Then the line gets wider", () => {
    assert.ok(getVisitWidth(6) > getVisitWidth(1));
  });
});

describe("Feature: building the coverage map from recorded points", () => {
  it("Given fewer than 2 points in a session, Then no polyline is produced", () => {
    const lines = buildCoveragePolylines([
      { latitude: 40, longitude: -73, sessionId: "a", timestamp: "2024-01-01T00:00:00Z" },
    ]);
    assert.equal(lines.length, 0);
  });

  it("Given two separate walks, Then each becomes its own polyline group", () => {
    const lines = buildCoveragePolylines([
      { latitude: 40.0, longitude: -73.0, sessionId: "a", timestamp: "2024-01-01T00:00:00Z" },
      { latitude: 40.001, longitude: -73.0, sessionId: "a", timestamp: "2024-01-01T00:00:10Z" },
      { latitude: 41.0, longitude: -74.0, sessionId: "b", timestamp: "2024-01-02T00:00:00Z" },
      { latitude: 41.001, longitude: -74.0, sessionId: "b", timestamp: "2024-01-02T00:00:10Z" },
    ]);
    assert.ok(lines.length >= 2);
  });

  it("Given out-of-order timestamps, Then the polyline is still drawn in chronological order", () => {
    const lines = buildCoveragePolylines([
      { latitude: 40.002, longitude: -73.0, sessionId: "a", timestamp: "2024-01-01T00:00:20Z" },
      { latitude: 40.0, longitude: -73.0, sessionId: "a", timestamp: "2024-01-01T00:00:00Z" },
      { latitude: 40.001, longitude: -73.0, sessionId: "a", timestamp: "2024-01-01T00:00:10Z" },
    ]);
    assert.ok(lines.length >= 1);
    const coords = lines[0].coordinates;
    assert.equal(coords[0].latitude, 40.0);
    assert.ok(coords[coords.length - 1].latitude >= coords[0].latitude);
  });
});

describe("Feature: human-readable stats", () => {
  it("formats duration as HH:MM:SS", () => {
    assert.equal(formatDuration(0), "00:00:00");
    assert.equal(formatDuration(3661), "01:01:01");
    assert.equal(formatDuration(59), "00:00:59");
  });
  it("formats distance in metres under 1km and km above", () => {
    assert.equal(formatDistance(0.45), "450 m");
    assert.equal(formatDistance(1.2345), "1.23 km");
  });
});

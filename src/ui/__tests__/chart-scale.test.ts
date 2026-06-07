import { describe, expect, it } from "vitest";
import {
  buildCurvePath,
  fromX,
  nearestFreqIndex,
  toX,
} from "../lib/chart-scale";

describe("toX / fromX", () => {
  it("maps the endpoints of the log axis", () => {
    expect(toX(20)).toBeCloseTo(0, 5);
    expect(toX(20000)).toBeCloseTo(200, 5);
  });

  it("clamps out-of-range frequencies", () => {
    expect(toX(5)).toBeCloseTo(0, 5);
    expect(toX(40000)).toBeCloseTo(200, 5);
  });

  it("round-trips through fromX", () => {
    for (const hz of [20, 100, 440, 1000, 6000, 20000]) {
      expect(fromX(toX(hz))).toBeCloseTo(hz, 3);
    }
  });
});

describe("nearestFreqIndex", () => {
  const freqs = [20, 100, 1000, 10000];

  it("finds the closest bin on a log scale", () => {
    expect(nearestFreqIndex(freqs, 950)).toBe(2);
    expect(nearestFreqIndex(freqs, 21)).toBe(0);
    expect(nearestFreqIndex(freqs, 9000)).toBe(3);
  });

  it("returns -1 for empty input", () => {
    expect(nearestFreqIndex([], 1000)).toBe(-1);
  });
});

describe("buildCurvePath", () => {
  it("returns empty string for fewer than two points", () => {
    expect(buildCurvePath([100], [1], (v) => v)).toBe("");
  });

  it("produces a move-to path for valid input", () => {
    const path = buildCurvePath([20, 1000, 20000], [0, -3, -6], (v) => v);
    expect(path.startsWith("M ")).toBe(true);
  });

  it("drops non-finite points", () => {
    const path = buildCurvePath([20, 1000, 20000], [0, NaN, -6], (v) => v);
    // Two finite points remain -> still draws.
    expect(path.startsWith("M ")).toBe(true);
  });
});

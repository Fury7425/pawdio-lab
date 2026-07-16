import { describe, expect, it } from "vitest";
import {
  computeVariationBand,
  interpolateLog,
  normalizeCurveAt,
  smoothFractionalOctave,
  subtractReference,
} from "../lib/curve-processing";

const curve = {
  freqs: [100, 1000, 10000],
  values: [2, 4, 8],
};

describe("curve processing", () => {
  it("interpolates halfway on a log-frequency axis", () => {
    expect(interpolateLog(curve, Math.sqrt(1000 * 10000))).toBeCloseTo(6);
  });

  it("normalizes at an exact interpolated frequency", () => {
    expect(normalizeCurveAt(curve, 1000).values).toEqual([-2, 0, 4]);
  });

  it("subtracts a reference on the measured curve grid", () => {
    const delta = subtractReference(
      { freqs: [100, 1000, 10000], values: [3, 7, 9] },
      curve,
    );
    expect(delta.values).toEqual([1, 3, 1]);
  });

  it("smooths without mutating the source curve", () => {
    const source = {
      freqs: [100, 200, 400, 800, 1600],
      values: [0, 0, 12, 0, 0],
    };
    const smoothed = smoothFractionalOctave(source, 1);
    expect(smoothed.values[2]).toBeLessThan(12);
    expect(source.values[2]).toBe(12);
  });

  it("computes percentile envelopes on a shared grid", () => {
    const band = computeVariationBand(
      [
        { freqs: [100, 1000], values: [0, 0] },
        { freqs: [100, 1000], values: [10, 10] },
      ],
      3,
    );
    expect(band).not.toBeNull();
    expect(band?.median).toEqual([5, 5, 5]);
    expect(band?.p10[0]).toBeCloseTo(1);
    expect(band?.p90[0]).toBeCloseTo(9);
  });
});

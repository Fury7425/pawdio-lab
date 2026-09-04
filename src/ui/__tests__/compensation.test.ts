import { describe, expect, it } from "vitest";
import {
  applyCompensation,
  boundsCoverage,
  boundsFromCurves,
  normalizeBoundsAt,
  parseCompensationText,
  populationBand,
  resampleBand,
  CompensationParseError,
} from "../lib/compensation";

const TWO_COLUMN = `* a comment line
# another comment
20.000000\t3.000
100.000000\t1.000
1000.000000\t0.000
10000.000000\t-2.000
`;

const SIX_COLUMN = `* population export
* Rig: something
20.0 -2.0 -1.0 0.0 1.0 2.0
1000.0 -4.0 -2.0 0.0 2.0 4.0
10000.0 -6.0 -3.0 0.0 3.0 6.0
`;

describe("parseCompensationText", () => {
  it("reads a two-column curve and skips comments", () => {
    const curve = parseCompensationText(TWO_COLUMN, "Rig Target");
    expect(curve.kind).toBe("curve");
    expect(curve.name).toBe("Rig Target");
    expect(curve.id).toBe("rig-target");
    expect(curve.freqs).toEqual([20, 100, 1000, 10000]);
    expect(curve.values).toEqual([3, 1, 0, -2]);
    expect(curve.percentiles).toBeUndefined();
  });

  it("reads a six-column population file and keeps the median as the line", () => {
    const curve = parseCompensationText(SIX_COLUMN, "Population");
    expect(curve.kind).toBe("population");
    expect(curve.values).toEqual([0, 0, 0]);
    expect(curve.percentiles?.p10).toEqual([-2, -4, -6]);
    expect(curve.percentiles?.p90).toEqual([2, 4, 6]);
  });

  it("accepts comma-separated columns", () => {
    const curve = parseCompensationText("20,1.5\n1000,0.5\n", "CSV");
    expect(curve.freqs).toEqual([20, 1000]);
    expect(curve.values).toEqual([1.5, 0.5]);
  });

  it("sorts rows and drops non-positive frequencies", () => {
    const curve = parseCompensationText(
      "1000 0\n0.000000 9\n20 3\n",
      "Unsorted",
    );
    expect(curve.freqs).toEqual([20, 1000]);
    expect(curve.values).toEqual([3, 0]);
  });

  it("rejects a file with nothing usable in it", () => {
    expect(() => parseCompensationText("* only comments\n", "Empty")).toThrow(
      CompensationParseError,
    );
  });
});

describe("applyCompensation", () => {
  it("subtracts the target and keeps the measurement grid", () => {
    const target = parseCompensationText(TWO_COLUMN, "Target");
    const measured = { freqs: [100, 1000, 10000], values: [5, 5, 5] };
    const result = applyCompensation(measured, target);
    expect(result.freqs).toEqual([100, 1000, 10000]);
    expect(result.values).toEqual([4, 5, 7]);
  });

  it("drops points the target does not cover rather than extrapolating", () => {
    const target = parseCompensationText(TWO_COLUMN, "Target");
    const measured = { freqs: [5, 1000, 30000], values: [1, 1, 1] };
    const result = applyCompensation(measured, target);
    expect(result.freqs).toEqual([1000]);
  });

  it("returns the input untouched when no target is selected", () => {
    const measured = { freqs: [100, 200], values: [1, 2] };
    expect(applyCompensation(measured, null)).toBe(measured);
  });
});

describe("populationBand", () => {
  it("expresses the spread relative to the median", () => {
    const curve = parseCompensationText(SIX_COLUMN, "Population");
    const band = populationBand(curve);
    expect(band?.median).toEqual([0, 0, 0]);
    expect(band?.p10).toEqual([-2, -4, -6]);
    expect(band?.p75).toEqual([1, 2, 3]);
  });

  it("returns nothing for a plain two-column curve", () => {
    expect(
      populationBand(parseCompensationText(TWO_COLUMN, "Plain")),
    ).toBeNull();
  });

  it("resamples onto another grid and drops what falls outside", () => {
    const band = populationBand(parseCompensationText(SIX_COLUMN, "P"));
    const resampled = resampleBand(band!, [10, 1000, 10000, 30000]);
    expect(resampled?.freqs).toEqual([1000, 10000]);
    expect(resampled?.p90).toEqual([4, 6]);
  });
});

describe("bounds", () => {
  const upper = parseCompensationText("20 6\n1000 4\n10000 2\n", "Upper");
  const lower = parseCompensationText("20 2\n1000 0\n10000 -2\n", "Lower");

  it("centres the pair on zero at the reference frequency", () => {
    const bounds = normalizeBoundsAt(boundsFromCurves(upper, lower), 1000);
    expect(bounds.upper.values[1]).toBeCloseTo(2, 6);
    expect(bounds.lower.values[1]).toBeCloseTo(-2, 6);
  });

  it("counts how much of a curve sits inside the bounds", () => {
    const bounds = boundsFromCurves(upper, lower);
    const coverage = boundsCoverage(
      { freqs: [20, 1000, 10000], values: [4, 9, 0] },
      bounds,
    );
    expect(coverage).toEqual({ inside: 2, total: 3 });
  });

  it("returns nothing when the curve and bounds do not overlap", () => {
    const bounds = boundsFromCurves(upper, lower);
    expect(
      boundsCoverage({ freqs: [1, 2], values: [0, 0] }, bounds),
    ).toBeNull();
  });
});

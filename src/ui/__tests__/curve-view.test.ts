import { describe, expect, it } from "vitest";
import { parseCompensationText } from "../lib/compensation";
import {
  processBounds,
  processCurve,
  viewSummary,
  type CurveViewOptions,
} from "../lib/curve-view";
import { boundsFromCurves } from "../lib/compensation";

const BASE: CurveViewOptions = {
  smoothing: null,
  normalize: false,
  normalizeHz: 1000,
  compensation: null,
  showPopulationBand: false,
};

const TARGET = parseCompensationText("20 2\n1000 0\n20000 -2\n", "Target");
const POPULATION = parseCompensationText(
  "20 -2 -1 0 1 2\n1000 -4 -2 0 2 4\n20000 -6 -3 0 3 6\n",
  "Population",
);

describe("processCurve", () => {
  it("passes a curve through untouched when nothing is enabled", () => {
    const curve = { freqs: [100, 1000, 10000], values: [1, 2, 3] };
    expect(processCurve(curve, BASE)).toEqual({
      freqs: [100, 1000, 10000],
      values: [1, 2, 3],
    });
  });

  it("normalises to zero at the reference frequency", () => {
    const curve = { freqs: [100, 1000, 10000], values: [5, 7, 9] };
    const result = processCurve(curve, { ...BASE, normalize: true });
    expect(result.values[1]).toBeCloseTo(0, 6);
    expect(result.values[0]).toBeCloseTo(-2, 6);
  });

  it("compensates before normalising, so the anchor lands on the final curve", () => {
    const curve = { freqs: [20, 1000, 20000], values: [5, 5, 5] };
    const result = processCurve(curve, {
      ...BASE,
      compensation: TARGET,
      normalize: true,
    });
    // Compensated values are 3, 5, 7; normalised at 1 kHz they become -2, 0, 2.
    expect(result.values).toHaveLength(3);
    expect(result.values[0]).toBeCloseTo(-2, 6);
    expect(result.values[1]).toBeCloseTo(0, 6);
    expect(result.values[2]).toBeCloseTo(2, 6);
  });

  it("smooths without shifting a flat curve", () => {
    const freqs = Array.from({ length: 64 }, (_, i) => 20 * Math.pow(1.12, i));
    const curve = { freqs, values: freqs.map(() => 4) };
    const result = processCurve(curve, { ...BASE, smoothing: 12 });
    for (const value of result.values) expect(value).toBeCloseTo(4, 5);
  });

  it("attaches a population envelope around the curve it belongs to", () => {
    const curve = { freqs: [20, 1000, 20000], values: [0, 0, 0] };
    const result = processCurve(curve, {
      ...BASE,
      compensation: POPULATION,
      showPopulationBand: true,
    });
    expect(result.band).toBeDefined();
    expect(result.band?.outerLow[1]).toBeCloseTo(-4, 6);
    expect(result.band?.outerHigh[1]).toBeCloseTo(4, 6);
    expect(result.band?.innerHigh[1]).toBeCloseTo(2, 6);
  });

  it("omits the envelope when the band is switched off", () => {
    const curve = { freqs: [20, 1000, 20000], values: [0, 0, 0] };
    const result = processCurve(curve, {
      ...BASE,
      compensation: POPULATION,
      showPopulationBand: false,
    });
    expect(result.band).toBeUndefined();
  });
});

describe("processBounds", () => {
  it("shifts both bounds by the same amount so the band keeps its width", () => {
    const upper = parseCompensationText("20 8\n1000 6\n", "Upper");
    const lower = parseCompensationText("20 2\n1000 2\n", "Lower");
    const bounds = processBounds(boundsFromCurves(upper, lower), {
      ...BASE,
      normalize: true,
    });
    const widthBefore = 6 - 2;
    const widthAfter = bounds.upper.values[1] - bounds.lower.values[1];
    expect(widthAfter).toBeCloseTo(widthBefore, 6);
    expect(bounds.upper.values[1]).toBeCloseTo(2, 6);
    expect(bounds.lower.values[1]).toBeCloseTo(-2, 6);
  });
});

describe("viewSummary", () => {
  it("names every step that is applied", () => {
    expect(
      viewSummary({
        ...BASE,
        smoothing: 24,
        normalize: true,
        compensation: TARGET,
      }),
    ).toBe("1/24 oct · 0 dB at 1 kHz · compensated to Target");
  });

  it("says raw and uncompensated when nothing is applied", () => {
    expect(viewSummary(BASE)).toBe("raw · uncompensated");
  });
});

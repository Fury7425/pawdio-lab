import { describe, expect, it } from "vitest";
import { ancAttenuation, averageSides } from "../lib/anc";
import { splitSavePath } from "../lib/save-text";
import { latencySummary } from "../pages/compare/compare-latency";
import { parseCompensationText } from "../lib/compensation";
import { combineAcceptedSweepPayloads } from "../lib/sweep-results";
import type { AncSnapshot, TestPayload } from "../model";

const snap = (left: number[], right: number[]): AncSnapshot => ({
  freqs: [100, 200, 300],
  magDbLeft: left,
  magDbRight: right,
  timestamp: "t",
});

describe("ancAttenuation", () => {
  it("subtracts the baseline over the shared length only", () => {
    const baseline = snap([10, 10], [10, 10, 10]);
    const mode = snap([4, 6, 8], [7, 7, 7]);
    expect(ancAttenuation(mode, baseline, "L")).toEqual([-6, -4]);
    expect(ancAttenuation(mode, baseline, "R")).toEqual([-3, -3, -3]);
  });

  it("gives an empty curve, not NaN, for a side never captured", () => {
    const baseline = snap([10, 10, 10], []);
    const mode = snap([4, 6, 8], [7, 7, 7]);
    expect(ancAttenuation(mode, baseline, "R")).toEqual([]);
    expect(averageSides([-6], [])).toEqual([-6]);
  });
});

describe("splitSavePath", () => {
  it("keeps the separator so a drive root stays absolute", () => {
    expect(splitSavePath("C:\\\\report.csv")).toEqual({
      dir: "C:\\\\",
      name: "report.csv",
    });
    expect(splitSavePath("/home/me/out.json")).toEqual({
      dir: "/home/me/",
      name: "out.json",
    });
  });
});

describe("latencySummary", () => {
  it("reads a saved LatencyReport", () => {
    const summary = latencySummary({
      signal: "chirp",
      sampleRate: 48000,
      inputSampleRate: 48000,
      measurements: [
        { iteration: 1, delayMs: 10 },
        { iteration: 2, delayMs: null },
      ],
      averageDelayMs: 10,
      stdDevMs: 0,
      cancelled: false,
      timestampUtc: "",
    });
    expect(summary.avg).toBe(10);
    expect(summary.measurements.filter((m) => m.delayMs !== null)).toHaveLength(
      1,
    );
  });

  it("reads a latency entry saved from the results list", () => {
    const payload: TestPayload = {
      test: "latency",
      timestamp: "",
      params: {},
      metrics: { average_delay_ms: 42.5, std_dev_ms: 1.5 },
      data: { measurements: [{ iteration: 1, delayMs: 42.5 }] },
      files: {},
    };
    const summary = latencySummary(payload);
    expect(summary.avg).toBe(42.5);
    expect(summary.std).toBe(1.5);
    expect(summary.measurements).toHaveLength(1);
  });
});

describe("parseCompensationText", () => {
  it("does not read a file with mixed row widths as a population export", () => {
    const text = "100 1 2 3 4 5\n200 7\n300 8\n";
    const curve = parseCompensationText(text, "mixed");
    expect(curve.kind).toBe("curve");
  });
});

describe("combineAcceptedSweepPayloads", () => {
  it("keeps the wireless alignment report of the last accepted sweep", () => {
    const payload = (alignment: unknown): TestPayload => ({
      test: "sweep_fr",
      timestamp: "t",
      params: {},
      metrics: { delay_ms_left: 1, delay_ms_right: 1, alignment },
      data: {
        freqs: [100, 200],
        left_mag_db_all: [[0, 0]],
        right_mag_db_all: [[0, 0]],
      },
      files: {},
    });
    const combined = combineAcceptedSweepPayloads(
      [payload({ driftRatio: 1.0001 }), payload({ driftRatio: 1.0002 })],
      { acceptedPerSide: 2, attempts: 2, captureOrder: "stereo" },
    );
    expect(combined.metrics.alignment).toEqual({ driftRatio: 1.0002 });
  });
});

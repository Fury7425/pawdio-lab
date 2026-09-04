import { describe, expect, it } from "vitest";
import {
  dbfsToDbSpl,
  dbfsToLinear,
  parseSplCalibration,
  REFERENCE_PRESSURE_PA,
  rmsToDbSpl,
  sensitivityDbFsPerPa,
  sensitivityFor,
  sensitivityFromCalibrator,
  sensitivityFromDbfs,
  splOffsetDb,
  withSensitivity,
  withoutSensitivity,
} from "../lib/spl-calibration";

describe("sensitivityFromCalibrator", () => {
  it("solves the one known point", () => {
    // A calibrator at 94 dB SPL producing exactly full scale means full scale
    // is one pascal.
    const sensitivity = sensitivityFromCalibrator(1, 94);
    expect(sensitivity).toBeCloseTo(1, 2);
  });

  it("scales inversely with the observed level", () => {
    const loud = sensitivityFromCalibrator(1, 94) as number;
    const quiet = sensitivityFromCalibrator(0.1, 94) as number;
    expect(quiet).toBeCloseTo(loud * 10, 5);
  });

  it("refuses a silent or invalid reading", () => {
    expect(sensitivityFromCalibrator(0, 94)).toBeNull();
    expect(sensitivityFromCalibrator(-1, 94)).toBeNull();
    expect(sensitivityFromCalibrator(Number.NaN, 94)).toBeNull();
    expect(sensitivityFromCalibrator(0.5, Number.NaN)).toBeNull();
  });

  it("agrees when given the same level as dBFS", () => {
    const fromLinear = sensitivityFromCalibrator(dbfsToLinear(-20), 94);
    const fromDbfs = sensitivityFromDbfs(-20, 94);
    expect(fromDbfs).toBeCloseTo(fromLinear as number, 8);
  });
});

describe("round trip", () => {
  it("recovers the calibrator level from the reading that produced it", () => {
    const rms = dbfsToLinear(-18);
    const sensitivity = sensitivityFromCalibrator(rms, 94) as number;
    expect(rmsToDbSpl(rms, sensitivity)).toBeCloseTo(94, 6);
    expect(dbfsToDbSpl(-18, sensitivity)).toBeCloseTo(94, 6);
  });

  it("tracks level changes one for one in dB", () => {
    const sensitivity = sensitivityFromDbfs(-20, 94) as number;
    expect(dbfsToDbSpl(-14, sensitivity)).toBeCloseTo(100, 6);
    expect(dbfsToDbSpl(-26, sensitivity)).toBeCloseTo(88, 6);
  });

  it("reports the offset that puts a relative curve on the absolute scale", () => {
    const sensitivity = sensitivityFromDbfs(-30, 94) as number;
    expect(splOffsetDb(-30, sensitivity)).toBeCloseTo(94, 6);
  });

  it("rejects a level of zero or a missing sensitivity", () => {
    expect(rmsToDbSpl(0, 1)).toBeNull();
    expect(rmsToDbSpl(0.5, 0)).toBeNull();
  });

  it("expresses full scale the way a datasheet would", () => {
    // Full scale equal to one pascal is 0 dB re 1 Pa.
    expect(sensitivityDbFsPerPa(1)).toBeCloseTo(0, 6);
    expect(sensitivityDbFsPerPa(0)).toBeNull();
  });

  it("uses the standard reference pressure", () => {
    expect(REFERENCE_PRESSURE_PA).toBeCloseTo(2e-5, 12);
  });
});

describe("store", () => {
  it("keeps sensitivities per device", () => {
    let store = withSensitivity(
      { sensitivityPaPerFs: {} },
      "Focusrite Input",
      0.5,
    );
    store = withSensitivity(store, "Onboard Mic", 2);
    expect(sensitivityFor(store, "Focusrite Input")).toBe(0.5);
    expect(sensitivityFor(store, "Onboard Mic")).toBe(2);
    expect(sensitivityFor(store, "Unknown")).toBeNull();
    expect(sensitivityFor(store, null)).toBeNull();
  });

  it("removes one device without touching the others", () => {
    const store = withoutSensitivity(
      { sensitivityPaPerFs: { A: 1, B: 2 } },
      "A",
    );
    expect(sensitivityFor(store, "A")).toBeNull();
    expect(sensitivityFor(store, "B")).toBe(2);
  });

  it("parses stored values and discards nonsense", () => {
    const parsed = parseSplCalibration(
      JSON.stringify({
        sensitivityPaPerFs: { good: 1.5, zero: 0, text: "x", negative: -1 },
      }),
    );
    expect(parsed.sensitivityPaPerFs).toEqual({ good: 1.5 });
  });

  it("falls back to empty on missing or broken storage", () => {
    expect(parseSplCalibration(null).sensitivityPaPerFs).toEqual({});
    expect(parseSplCalibration("not json").sensitivityPaPerFs).toEqual({});
    expect(parseSplCalibration("[]").sensitivityPaPerFs).toEqual({});
  });
});

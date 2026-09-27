import { describe, expect, it } from "vitest";
import {
  balanceStats,
  bestIndex,
  buildLibraryExport,
  crosstalkStats,
  findDeviceByName,
  parseLibraryExport,
  thdPoints,
} from "../lib/library";
import type { MeasurementRecord, TestPayload } from "../model";

const payload = (
  metrics: Record<string, unknown>,
  params: Record<string, unknown> = {},
): TestPayload => ({
  test: "x",
  timestamp: "",
  params,
  metrics,
  data: {},
  files: {},
});

describe("bestIndex", () => {
  it("picks by direction and ignores missing values", () => {
    expect(bestIndex([3, null, 1], "lower")).toBe(2);
    expect(bestIndex([3, 5, 1], "higher")).toBe(1);
    expect(bestIndex([-2, 0.5, 1], "zero")).toBe(1);
  });

  it("has no winner for a single value or a tie", () => {
    expect(bestIndex([4, null], "lower")).toBe(-1);
    expect(bestIndex([2, 2], "lower")).toBe(-1);
  });
});

describe("metric readers", () => {
  it("reads THD tones, balance and crosstalk payloads", () => {
    expect(
      thdPoints(
        payload({
          items: [
            { freq: 1000, thd_percent: 0.05 },
            { freq: "bad", thd_percent: 1 },
          ],
        }),
      ),
    ).toEqual([{ freq: 1000, thdPercent: 0.05 }]);
    expect(
      balanceStats(
        payload(
          { left_dBFS: -12, right_dBFS: -12.5, L_minus_R_dB: 0.5 },
          { freq: 1000 },
        ),
      ),
    ).toEqual({ freq: 1000, left: -12, right: -12.5, diff: 0.5 });
    expect(
      crosstalkStats(
        payload({ crosstalk_dB: -48 }, { freq: 1000, direction: "LtoR" }),
      ),
    ).toEqual({ freq: 1000, direction: "LtoR", db: -48 });
  });
});

describe("findDeviceByName", () => {
  it("matches ignoring case and spacing", () => {
    const devices = [{ id: 7, name: "AirPods  Pro", createdAt: 0 }];
    expect(findDeviceByName(devices, " airpods pro ")?.id).toBe(7);
    expect(findDeviceByName(devices, "")).toBeUndefined();
  });
});

describe("library export round trip", () => {
  const record: MeasurementRecord = {
    id: 3,
    deviceId: 1,
    testType: "thd",
    capturedAt: 1_700_000_000_000,
    label: "Foam tips",
    notes: null,
    schemaVer: 1,
    payload: payload({ items: [] }),
  };

  it("parses what the export writes", () => {
    const text = JSON.stringify(
      buildLibraryExport([{ record, deviceName: "IEM" }], "thd"),
    );
    expect(parseLibraryExport(text)).toEqual([
      {
        deviceName: "IEM",
        testType: "thd",
        capturedAt: 1_700_000_000_000,
        label: "Foam tips",
        notes: null,
        payload: record.payload,
      },
    ]);
  });

  it("rejects files that are not a library export", () => {
    expect(() => parseLibraryExport("nope")).toThrow(/not valid JSON/);
    expect(() => parseLibraryExport('{"records": []}')).toThrow(
      /not a Pawdio Lab library export/,
    );
  });
});

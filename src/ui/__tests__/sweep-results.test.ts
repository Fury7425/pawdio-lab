import { describe, expect, it } from "vitest";
import type { TestPayload } from "../model";
import { combineAcceptedSweepPayloads } from "../lib/sweep-results";

function payload(
  timestamp: string,
  left: number[],
  right: number[],
): TestPayload {
  return {
    test: "sweep_fr",
    timestamp,
    params: { repeats: 1 },
    metrics: { delay_ms_left: 10, delay_ms_right: 12 },
    data: {
      freqs: [100, 1000],
      left_mag_db_avg: left,
      left_mag_db_all: left.length ? [left] : [],
      right_mag_db_avg: right,
      right_mag_db_all: right.length ? [right] : [],
      mag_db_all: [left, right].filter((curve) => curve.length),
      mag_db_avg_all: [],
    },
    files: {},
  };
}

describe("combineAcceptedSweepPayloads", () => {
  it("averages only the approved payloads and records the accepted count", () => {
    const result = combineAcceptedSweepPayloads(
      [
        payload("first", [0, 2], [2, 4]),
        payload("second", [2, 4], [4, 6]),
      ],
      { acceptedPerSide: 2, attempts: 3, captureOrder: "stereo" },
    );

    expect(result.params.accepted_repeats).toBe(2);
    expect(result.params.total_attempts).toBe(3);
    expect(result.data.left_mag_db_avg).toEqual([1, 3]);
    expect(result.data.right_mag_db_avg).toEqual([3, 5]);
    expect(result.timestamp).toBe("second");
  });

  it("combines approved left-first mono captures without inventing channels", () => {
    const result = combineAcceptedSweepPayloads(
      [payload("left", [1, 2], []), payload("right", [], [3, 4])],
      { acceptedPerSide: 1, attempts: 2, captureOrder: "left_first" },
    );

    expect(result.params.mono_mode).toBe(true);
    expect(result.data.left_mag_db_all).toEqual([[1, 2]]);
    expect(result.data.right_mag_db_all).toEqual([[3, 4]]);
    expect(result.data.mag_db_avg_all).toEqual([2, 3]);
  });
});

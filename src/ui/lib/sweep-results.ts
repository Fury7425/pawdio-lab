import type { CaptureOrder, TestPayload } from "../model";

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sweepNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
}

function curveList(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((curve) => sweepNumberList(curve))
    .filter((curve) => curve.length > 0);
}

function averageCurves(curves: number[][]): number[] {
  const usable = curves.filter((curve) => curve.length > 0);
  if (usable.length === 0) return [];
  const length = Math.min(...usable.map((curve) => curve.length));
  return Array.from({ length }, (_, index) => {
    return (
      usable.reduce((sum, curve) => sum + curve[index], 0) / usable.length
    );
  });
}

function averageMetric(payloads: TestPayload[], key: string): number | null {
  const values = payloads
    .map((payload) => recordOrEmpty(payload.metrics)[key])
    .filter((value): value is number => {
      return typeof value === "number" && Number.isFinite(value);
    });
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type AcceptedSweepSummary = {
  acceptedPerSide: number;
  attempts: number;
  captureOrder: CaptureOrder;
};

/**
 * Combine individually approved one-repeat payloads into the same shape as a
 * normal multi-repeat backend result. Rejected payloads are never passed here,
 * so averages, history, and exports contain approved captures only.
 */
export function combineAcceptedSweepPayloads(
  payloads: TestPayload[],
  summary: AcceptedSweepSummary,
): TestPayload {
  if (payloads.length === 0) {
    throw new Error("Cannot combine an empty set of accepted sweeps.");
  }

  const first = payloads[0];
  const last = payloads[payloads.length - 1];
  const dataRecords = payloads.map((payload) => recordOrEmpty(payload.data));
  const freqs =
    dataRecords
      .map((data) => sweepNumberList(data.freqs))
      .find((curve) => curve.length > 0) ?? [];
  const leftAll = dataRecords.flatMap((data) =>
    curveList(data.left_mag_db_all),
  );
  const rightAll = dataRecords.flatMap((data) =>
    curveList(data.right_mag_db_all),
  );
  const allCurves = [...leftAll, ...rightAll];
  const acceptedRunFiles = payloads.map((payload) =>
    recordOrEmpty(payload.files),
  );
  const mergedFiles = Object.assign({}, ...acceptedRunFiles);

  return {
    test: "sweep_fr",
    timestamp: last.timestamp,
    params: {
      ...recordOrEmpty(first.params),
      ...recordOrEmpty(last.params),
      repeats: summary.acceptedPerSide,
      accepted_repeats: summary.acceptedPerSide,
      total_attempts: summary.attempts,
      capture_order: summary.captureOrder,
      mono_mode: summary.captureOrder !== "stereo",
    },
    metrics: {
      delay_ms_left: averageMetric(payloads, "delay_ms_left"),
      delay_ms_right: averageMetric(payloads, "delay_ms_right"),
    },
    data: {
      freqs,
      left_mag_db_avg: averageCurves(leftAll),
      left_mag_db_all: leftAll,
      right_mag_db_avg: averageCurves(rightAll),
      right_mag_db_all: rightAll,
      mag_db_all: allCurves,
      mag_db_avg_all: averageCurves(allCurves),
    },
    files: {
      ...mergedFiles,
      accepted_runs: acceptedRunFiles,
    },
  };
}

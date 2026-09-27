/**
 * Pure helpers for the measurement library: reading metrics out of saved
 * payloads, matching devices by name, and the JSON export/import format.
 * Kept free of React and IPC so they can be unit tested directly.
 */
import type {
  DeviceRecord,
  LibraryTestType,
  MeasurementRecord,
  MeasurementSummary,
} from "../model";

export const LIBRARY_EXPORT_FORMAT = "pawdio-lab-library-export";

type Payload = MeasurementRecord["payload"];

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export type LatencyStats = {
  avg: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  n: number;
};

/**
 * Latency is saved in two shapes: the latest-run `LatencyReport`
 * (`averageDelayMs`, …) and the results-list `TestPayload`
 * (`metrics.average_delay_ms`, `data.measurements`). Read either.
 */
export function latencyStats(payload: Payload): LatencyStats {
  const record = obj(payload);
  const metrics = obj(record.metrics);
  const data = obj(record.data);
  const raw = Array.isArray(record.measurements)
    ? record.measurements
    : Array.isArray(data.measurements)
      ? data.measurements
      : [];
  const delays = raw
    .map((item) => num(obj(item).delayMs))
    .filter((value): value is number => value !== null);
  return {
    avg: num(record.averageDelayMs) ?? num(metrics.average_delay_ms),
    std: num(record.stdDevMs) ?? num(metrics.std_dev_ms),
    min: delays.length ? Math.min(...delays) : null,
    max: delays.length ? Math.max(...delays) : null,
    n: delays.length,
  };
}

/** THD per tone, from `metrics.items` (`{ freq, thd_percent }`). */
export function thdPoints(
  payload: Payload,
): Array<{ freq: number; thdPercent: number }> {
  const items = obj(obj(payload).metrics).items;
  if (!Array.isArray(items)) return [];
  const out: Array<{ freq: number; thdPercent: number }> = [];
  for (const item of items) {
    const freq = num(obj(item).freq);
    const thdPercent = num(obj(item).thd_percent);
    if (freq !== null && thdPercent !== null) out.push({ freq, thdPercent });
  }
  return out;
}

export function balanceStats(payload: Payload) {
  const record = obj(payload);
  const metrics = obj(record.metrics);
  return {
    freq: num(obj(record.params).freq),
    left: num(metrics.left_dBFS),
    right: num(metrics.right_dBFS),
    diff: num(metrics.L_minus_R_dB),
  };
}

export function crosstalkStats(payload: Payload) {
  const record = obj(payload);
  const params = obj(record.params);
  return {
    freq: num(params.freq),
    direction: typeof params.direction === "string" ? params.direction : null,
    db: num(obj(record.metrics).crosstalk_dB),
  };
}

export type Better = "lower" | "higher" | "zero";

/**
 * Index of the winning value, or -1 when fewer than two values are finite
 * (a single number has nothing to beat) or when every value ties.
 */
export function bestIndex(values: Array<number | null>, better: Better) {
  const score = (value: number) =>
    better === "higher" ? -value : better === "zero" ? Math.abs(value) : value;
  let best = -1;
  let finite = 0;
  let allEqual = true;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    finite += 1;
    if (best >= 0 && score(value) !== score(values[best] as number)) {
      allEqual = false;
    }
    if (best < 0 || score(value) < score(values[best] as number)) best = index;
  });
  return finite < 2 || allEqual ? -1 : best;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Match a device by name ignoring case and spacing, so saving a result for
 * "AirPods Pro " files it under the existing "airpods pro" device instead of
 * creating a duplicate.
 */
export function findDeviceByName(
  devices: DeviceRecord[],
  name: string,
): DeviceRecord | undefined {
  const key = normalizeName(name);
  return key ? devices.find((d) => normalizeName(d.name) === key) : undefined;
}

export { normalizeName as normalizeDeviceName };

export type ImportedRecord = {
  deviceName: string;
  testType: LibraryTestType;
  capturedAt: number;
  label: string | null;
  notes: string | null;
  payload: Payload;
};

export function buildLibraryExport(
  entries: Array<{ record: MeasurementRecord; deviceName: string }>,
  testType: string | null,
) {
  return {
    format: LIBRARY_EXPORT_FORMAT,
    version: 1,
    generatedAt: new Date().toISOString(),
    testType,
    count: entries.length,
    records: entries.map(({ record, deviceName }) => ({
      deviceName,
      ...record,
    })),
  };
}

/**
 * Parse a library export. Throws with a readable message when the file is not
 * one; skips individual records that are missing a device, type or payload.
 */
export function parseLibraryExport(text: string): ImportedRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const root = obj(parsed);
  if (root.format !== LIBRARY_EXPORT_FORMAT || !Array.isArray(root.records)) {
    throw new Error("The file is not a Pawdio Lab library export.");
  }
  const out: ImportedRecord[] = [];
  for (const item of root.records) {
    const record = obj(item);
    const deviceName =
      typeof record.deviceName === "string" ? record.deviceName.trim() : "";
    const testType =
      typeof record.testType === "string" ? record.testType.trim() : "";
    if (!deviceName || !testType || !record.payload) continue;
    if (typeof record.payload !== "object") continue;
    out.push({
      deviceName,
      testType: testType as LibraryTestType,
      capturedAt: num(record.capturedAt) ?? Date.now(),
      label: typeof record.label === "string" ? record.label : null,
      notes: typeof record.notes === "string" ? record.notes : null,
      payload: record.payload as Payload,
    });
  }
  return out;
}

/** Key that identifies the same capture, so re-importing a file adds nothing. */
export function captureKey(
  deviceId: number,
  testType: string,
  capturedAt: number,
): string {
  return `${deviceId}|${testType}|${capturedAt}`;
}

export function existingCaptureKeys(summaries: MeasurementSummary[]) {
  return new Set(
    summaries.map((s) => captureKey(s.deviceId, s.testType, s.capturedAt)),
  );
}

/** Short capture time for list rows and column headers; the year only when it is not this one. */
export function formatCaptured(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleString(undefined, {
    year: otherYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

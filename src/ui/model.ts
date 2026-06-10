export type PageKey =
  | "latency"
  | "sweep_fr"
  | "anc"
  | "experimental"
  | "devices"
  | "results"
  | "library";

export enum PageKeyEnum {
  Latency = "latency",
  SweepFr = "sweep_fr",
  Anc = "anc",
  Experimental = "experimental",
  Devices = "devices",
  Results = "results",
  Library = "library",
}

export type AudioDeviceInfo = {
  index: number;
  name: string;
  isInput: boolean;
  channels: number;
  defaultSampleRate: number;
};

export type DeviceInventory = {
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
  defaultInputIndex: number | null;
  defaultOutputIndex: number | null;
};

export type AudioSettings = {
  outputDeviceIndex: number | null;
  inputDeviceIndex: number | null;
  outputSampleRate: number;
  inputSampleRate: number;
  durationSecs: number;
  chunkSize: number;
  itemName: string;
};

export type RuntimeStatus = { running: boolean };

export type LatencyRequest = {
  signal: "sine" | "impulse" | "pinkNoise";
  frequencyHz: number;
  durationSecs: number;
  amplitude: number;
  repeats: number;
  recordMarginSecs: number;
  outputDir: string;
  savePerSoundPlot: boolean;
  saveOverallBarChart: boolean;
  calibratedOffsetMs: number;
  sharedOutputDir?: string;
  sharedRunTag?: string;
};

export type LatencyCalibration = {
  perSoundOffsetsMs: Record<string, number>;
};

/**
 * Capture order for the "advanced mono mode" shared by Sweep FR and ANC.
 * - `stereo`: one capture, both channels at once (a stereo measurement rig).
 * - `left_first` / `right_first`: guided per-side capture (single mic moved
 *   between ears); the value picks which ear is measured first.
 */
export type CaptureOrder = "stereo" | "left_first" | "right_first";

export const CAPTURE_ORDER_META: Record<
  CaptureOrder,
  { label: string; detail: string }
> = {
  stereo: { label: "Stereo", detail: "Both ears at once" },
  left_first: { label: "Left first", detail: "Left ear, then right" },
  right_first: { label: "Right first", detail: "Right ear, then left" },
};

export type SweepRequest = {
  f0: number;
  f1: number;
  durationSecs: number;
  repeats: number;
  amplitude: number;
  outputDir: string;
  savePlots: boolean;
  saveSquiglink: boolean;
  monoMode: boolean;
  captureOrder: CaptureOrder;
  sharedRunTag?: string;
};

export type BalanceRequest = {
  frequencyHz: number;
  toneDurationSecs: number;
  settleSecs: number;
};

export type CrosstalkRequest = {
  frequencyHz: number;
  toneDurationSecs: number;
  settleSecs: number;
  direction: "LtoR" | "RtoL";
};

export type ThdRequest = {
  tones: number[];
  toneDurationSecs: number;
  amplitude: number;
};

export type IsolationRequest = {
  noiseDurationSecs: number;
  amplitude: number;
};

export type AncModeKey =
  | "true_reference"
  | "reference"
  | "anc"
  | "transparency";

export type AncRequest = {
  f0: number;
  f1: number;
  durationSecs: number;
  repeats: number;
  amplitude: number;
  outputDir: string;
  savePlots: boolean;
  captureOrder: CaptureOrder;
};

export type AncSnapshot = {
  freqs: number[];
  magDbLeft: number[];
  magDbRight: number[];
  timestamp: string;
};

export type AncCaptures = Partial<Record<AncModeKey, AncSnapshot>>;

export const ANC_MODE_ORDERED: AncModeKey[] = [
  "true_reference",
  "reference",
  "anc",
  "transparency",
];

export const ANC_MODE_META: Record<
  AncModeKey,
  {
    label: string;
    detail: string;
    helpText: string;
    captureTitle: string;
    captureDetail: string;
    color: string;
  }
> = {
  true_reference: {
    label: "Open Ears (no headphones)",
    detail: "Bare mic, nothing worn",
    helpText:
      "Use this for absolute attenuation numbers. Skip if you only want to compare ANC vs passive.",
    captureTitle: "Open Ears",
    captureDetail:
      "Remove your headphones completely. The mic captures the raw room signal.",
    color: "var(--gray-8)",
  },
  reference: {
    label: "Headphones On, Power Off",
    detail: "Worn but every mode disabled",
    helpText:
      "The default baseline. Put the headphones on but keep ANC and Transparency off.",
    captureTitle: "Baseline (Power Off)",
    captureDetail:
      "Put the headphones on. Disable ANC and Transparency: fully off, not Transparency.",
    color: "var(--gray-10)",
  },
  anc: {
    label: "ANC On",
    detail: "Active noise cancellation engaged",
    helpText:
      "Toggle ANC on the headphones, then capture. Compared to baseline gives ANC attenuation curve.",
    captureTitle: "ANC On",
    captureDetail:
      "Turn on Active Noise Cancellation on your headphones, then start.",
    color: "var(--accent-9)",
  },
  transparency: {
    label: "Transparency / Ambient",
    detail: "Pass-through mode engaged",
    helpText:
      "Toggle Transparency / Ambient on the headphones. Curve will usually sit near 0 dB or slightly above.",
    captureTitle: "Transparency / Ambient",
    captureDetail:
      "Switch to Transparency or Ambient mode on your headphones, then start.",
    color: "hsl(175, 65%, 45%)",
  },
};

export type LatencyProgress = {
  current: number;
  total: number;
  delayMs: number | null;
};

export type LatencyReport = {
  signal: string;
  sampleRate: number;
  inputSampleRate: number;
  measurements: Array<{ iteration: number; delayMs: number | null }>;
  averageDelayMs: number | null;
  stdDevMs: number | null;
  cancelled: boolean;
  timestampUtc: string;
};

export type TestPayload = {
  test: string;
  timestamp: string;
  params: Record<string, unknown>;
  metrics: Record<string, unknown>;
  data: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type TestProgress = {
  test: string;
  current: number;
  total: number;
  value: number | null;
  message: string;
};

export type ResultEntry = {
  id: number;
  payload: TestPayload;
  label?: string;
  savedAt?: number;
  deviceName?: string;
};

// Measurement library (SQLite-backed; see src-tauri/src/db.rs) ----------------

export type LibraryTestType =
  | "latency"
  | "sweep_fr"
  | "thd"
  | "balance"
  | "crosstalk"
  | "isolation"
  | "anc";

export type DeviceRecord = {
  id: number;
  name: string;
  kind?: string | null;
  notes?: string | null;
  createdAt: number;
};

export type MeasurementSummary = {
  id: number;
  deviceId: number;
  testType: LibraryTestType;
  capturedAt: number;
  label?: string | null;
};

/**
 * A full saved measurement. `payload` is the same JSON the test produced —
 * discriminated by `testType`: `LatencyReport` for "latency", `AncCaptures`
 * for "anc", otherwise `TestPayload`.
 */
export type MeasurementRecord = MeasurementSummary & {
  notes?: string | null;
  schemaVer: number;
  payload: LatencyReport | TestPayload | AncCaptures;
};

export const LIBRARY_TEST_LABELS: Record<LibraryTestType, string> = {
  latency: "Latency",
  sweep_fr: "Frequency Response",
  thd: "THD",
  balance: "Channel Balance",
  crosstalk: "Crosstalk",
  isolation: "Isolation",
  anc: "ANC / Transparency",
};

/** Test types that have a comparison renderer in v1. */
export const COMPARABLE_TEST_TYPES: ReadonlySet<LibraryTestType> = new Set([
  "sweep_fr",
  "latency",
  "anc",
]);

export const pageItems: Array<{ key: PageKey; label: string }> = [
  { key: "latency", label: "Latency" },
  { key: "sweep_fr", label: "Sweep FR" },
  { key: "anc", label: "ANC / Transparency" },
  { key: "devices", label: "Devices / Settings" },
  { key: "results", label: "Results / Export" },
  { key: "library", label: "Library / Compare" },
  { key: "experimental", label: "Experimental Tests" },
];

const VALID_PAGE_KEYS: ReadonlySet<string> = new Set(
  pageItems.map((item) => item.key),
);

/**
 * Validate a persisted/unknown value as a `PageKey`, falling back to "latency".
 * Backed by `pageItems` (the single source of truth for navigable pages) so a
 * newly added page can't silently fail to restore from localStorage.
 */
export function parsePageKey(value: unknown): PageKey {
  return typeof value === "string" && VALID_PAGE_KEYS.has(value)
    ? (value as PageKey)
    : "latency";
}

export const defaultAncRequest: AncRequest = {
  f0: 20,
  f1: 20000,
  durationSecs: 6,
  repeats: 1,
  amplitude: 0.5,
  outputDir: "",
  savePlots: true,
  captureOrder: "stereo",
};

export const defaultSettings: AudioSettings = {
  outputDeviceIndex: null,
  inputDeviceIndex: null,
  outputSampleRate: 44100,
  inputSampleRate: 44100,
  durationSecs: 0.5,
  chunkSize: 1024,
  itemName: "",
};

export const defaultLatencyRequest: LatencyRequest = {
  signal: "impulse",
  frequencyHz: 1000,
  durationSecs: 0.5,
  amplitude: 0.85,
  repeats: 5,
  recordMarginSecs: 1,
  outputDir: "",
  savePerSoundPlot: true,
  saveOverallBarChart: true,
  calibratedOffsetMs: 0,
};

export const defaultLatencyCalibration: LatencyCalibration = {
  perSoundOffsetsMs: {},
};

export const defaultSweepRequest: SweepRequest = {
  f0: 20,
  f1: 20000,
  durationSecs: 6,
  repeats: 1,
  amplitude: 0.5,
  outputDir: "",
  savePlots: true,
  saveSquiglink: true,
  monoMode: false,
  captureOrder: "stereo",
};

export const defaultBalanceRequest: BalanceRequest = {
  frequencyHz: 1000,
  toneDurationSecs: 1,
  settleSecs: 0.2,
};

export const defaultCrosstalkRequest: CrosstalkRequest = {
  frequencyHz: 1000,
  toneDurationSecs: 1,
  settleSecs: 0.2,
  direction: "LtoR",
};

export const defaultThdRequest: ThdRequest = {
  tones: [100, 1000, 6000],
  toneDurationSecs: 1,
  amplitude: 0.6,
};

export const defaultIsolationRequest: IsolationRequest = {
  noiseDurationSecs: 2,
  amplitude: 0.4,
};

export function toSelectValue(index: number | null): string {
  return index === null ? "none" : String(index);
}

export function fromSelectValue(value: string): number | null {
  if (value === "none") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function fmtMs(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)} ms`;
}

export function parseToneList(value: string): number[] {
  return value
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

export function legacyTimestamp(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  const yy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mi = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

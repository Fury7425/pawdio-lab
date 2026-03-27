export type PageKey =
  | "latency"
  | "sweep_fr"
  | "experimental"
  | "devices"
  | "results";

export enum PageKeyEnum {
  Latency = "latency",
  SweepFr = "sweep_fr",
  Experimental = "experimental",
  Devices = "devices",
  Results = "results",
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


export const pageItems: Array<{ key: PageKey; label: string }> = [
  { key: "latency", label: "Latency" },
  { key: "sweep_fr", label: "Sweep FR" },
  { key: "devices", label: "Devices / Settings" },
  { key: "results", label: "Results / Export" },
  { key: "experimental", label: "Experimental Tests" },
];

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

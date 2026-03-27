import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AudioSettings,
  CrosstalkRequest,
  DeviceInventory,
  IsolationRequest,
  LatencyCalibration,
  LatencyProgress,
  LatencyReport,
  LatencyRequest,
  PageKey,
  ResultEntry,
  RuntimeStatus,
  SavedComparison,
  SweepRequest,
  TestPayload,
  TestProgress,
  ThdRequest,
  defaultBalanceRequest,
  defaultCrosstalkRequest,
  defaultIsolationRequest,
  defaultLatencyCalibration,
  defaultLatencyRequest,
  defaultSettings,
  defaultSweepRequest,
  defaultThdRequest,
  legacyTimestamp,
  parseToneList,
} from "./model";

// Type for database entries from Rust backend
type DatabaseEntry = {
  id: string;
  deviceName: string;
  timestamp: string;
  testType: string;
  folderPath: string;
  hasPlots: boolean;
  hasReport: boolean;
};

type LatencyPresetConfig = {
  uiKey: "beep1k" | "beep2k" | "beep5k" | "beep200" | "impulse";
  storageKey: string;
  label: string;
  signal: LatencyRequest["signal"];
  frequencyHz: number;
};

type LatencyExportEntry = {
  request: LatencyRequest;
  report: LatencyReport;
};

type LatencyRunResult = {
  report: LatencyReport;
  calibratedOffsetMs: number;
};

type InputLevelEvent = {
  currentDbfs: number;
  peakDbfs: number;
  clipCount: number;
  roughFrHz?: number[];
  roughFrDb?: number[];
};

type InputMonitorState = {
  monitoring: boolean;
  status: string;
  currentDbfs: number;
  peakDbfs: number;
  clipCount: number;
  splEstimate: number;
  roughFrHz: number[];
  roughFrDb: number[];
};

const CALIBRATION_STORAGE_KEY = "pawdio-lab-latency-calibration-v1";
const UI_STATE_STORAGE_KEY = "pawdio-lab-ui-state-v1";
const HISTORY_STORAGE_KEY = "pawdio-lab-history-v1";
const COMPARISONS_STORAGE_KEY = "pawdio-lab-comparisons-v1";

// History/Database helper functions
function loadHistory(): ResultEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ResultEntry[];
  } catch {
    return [];
  }
}

// Convert DatabaseEntry from Rust to ResultEntry format
function databaseEntryToResultEntry(entry: DatabaseEntry): ResultEntry {
  // Parse timestamp from format like "20250615_143022"
  let savedAt: number | undefined;
  try {
    const ts = entry.timestamp;
    const parsed = new Date(`${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}T${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)}`);
    if (!isNaN(parsed.getTime())) {
      savedAt = parsed.getTime();
    }
  } catch {
    // ignore parsing errors
  }

  return {
    id: parseInt(entry.id.split(':')[0]) || Math.floor(Math.random() * 10000),
    deviceName: entry.deviceName,
    savedAt: savedAt,
    payload: {
      test: entry.testType,
      timestamp: entry.timestamp,
      params: { folderPath: entry.folderPath },
      metrics: {},
      data: {},
      files: { hasPlots: entry.hasPlots, hasReport: entry.hasReport },
    },
  };
}

// Scan filesystem for existing test results
async function scanDatabaseFiles(outputDirs: string[]): Promise<ResultEntry[]> {
  try {
    const entries = await invoke<DatabaseEntry[]>("scan_database", { outputDirs });
    return entries.map(databaseEntryToResultEntry);
  } catch (err) {
    console.error("Failed to scan database:", err);
    return [];
  }
}

function saveHistory(history: ResultEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore storage errors
  }
}

function addToHistory(entry: ResultEntry): void {
  const history = loadHistory();
  history.unshift(entry); // Add to beginning (newest first)
  // Keep only last 100 entries
  const trimmed = history.slice(0, 100);
  saveHistory(trimmed);
}

function deleteFromHistory(id: number): void {
  const history = loadHistory();
  const filtered = history.filter((entry) => entry.id !== id);
  saveHistory(filtered);
}

function clearHistory(): void {
  saveHistory([]);
}

function loadComparisons(): SavedComparison[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(COMPARISONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedComparison[];
  } catch {
    return [];
  }
}

function saveComparisons(comparisons: SavedComparison[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COMPARISONS_STORAGE_KEY, JSON.stringify(comparisons));
  } catch {
    // ignore storage errors
  }
}

function addComparison(leftId: number, rightId: number, name: string): void {
  const comparisons = loadComparisons();
  comparisons.push({
    id: `comp_${Date.now()}`,
    name,
    leftId,
    rightId,
    createdAt: Date.now(),
  });
  saveComparisons(comparisons);
}

function deleteComparison(id: string): void {
  const comparisons = loadComparisons();
  const filtered = comparisons.filter((c) => c.id !== id);
  saveComparisons(filtered);
}

const LATENCY_PRESETS: LatencyPresetConfig[] = [
  {
    uiKey: "beep1k",
    storageKey: "beep_1k",
    label: "1kHz Beep",
    signal: "sine",
    frequencyHz: 1000,
  },
  {
    uiKey: "beep2k",
    storageKey: "beep_2k",
    label: "Mixed (2kHz Sine)",
    signal: "sine",
    frequencyHz: 2000,
  },
  {
    uiKey: "beep5k",
    storageKey: "beep_5k",
    label: "5kHz Beep",
    signal: "sine",
    frequencyHz: 5000,
  },
  {
    uiKey: "beep200",
    storageKey: "beep_200",
    label: "200Hz Low Beep",
    signal: "sine",
    frequencyHz: 200,
  },
  {
    uiKey: "impulse",
    storageKey: "impulse",
    label: "Click (Impulse)",
    signal: "impulse",
    frequencyHz: 1000,
  },
];

const DEFAULT_INPUT_MONITOR: InputMonitorState = {
  monitoring: false,
  status: "Ready to measure...",
  currentDbfs: -96,
  peakDbfs: -96,
  clipCount: 0,
  splEstimate: -2,
  roughFrHz: [],
  roughFrDb: [],
};

type PersistedUiState = {
  activePage?: PageKey;
  experimentalEnabled?: boolean;
  settings?: Partial<AudioSettings>;
  latencyRequest?: Partial<LatencyRequest>;
  sweepRequest?: Partial<SweepRequest>;
  balanceRequest?: Partial<typeof defaultBalanceRequest>;
  crosstalkRequest?: Partial<CrosstalkRequest>;
  thdRequest?: Partial<ThdRequest>;
  thdToneText?: string;
  isolationRequest?: Partial<IsolationRequest>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readPersistedUiState(): PersistedUiState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(UI_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return toRecord(parsed) ? (parsed as PersistedUiState) : null;
  } catch {
    return null;
  }
}

function mergeWithDefaults<T extends Record<string, unknown>>(
  defaults: T,
  stored: unknown,
): T {
  const record = toRecord(stored);
  if (!record) {
    return defaults;
  }
  return { ...defaults, ...(record as Partial<T>) };
}

function parsePageKey(value: unknown): PageKey {
  if (
    value === "latency" ||
    value === "sweep_fr" ||
    value === "experimental" ||
    value === "devices" ||
    value === "results"
  ) {
    return value;
  }
  return "latency";
}

type SweepMonoSide = "left" | "right" | "both";
type SweepInvokeRequest = SweepRequest & { monoSide?: SweepMonoSide };

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return toRecord(value) ?? {};
}

function numberCurveList(value: unknown): number[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((curve) => {
      if (!Array.isArray(curve)) {
        return null;
      }
      const cast = curve
        .map((point) => (typeof point === "number" ? point : Number(point)))
        .filter((point) => Number.isFinite(point));
      return cast.length > 0 ? cast : null;
    })
    .filter((curve): curve is number[] => curve !== null);
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
}

function exportTimestampTag(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function triggerDownload(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sweepAverageCurve(
  payload: TestPayload,
): { freqs: number[]; mags: number[] } | null {
  const data = recordOrEmpty(payload.data);
  const freqs = numberList(data.freqs);
  if (freqs.length === 0) {
    return null;
  }

  const avgAll = numberList(data.mag_db_avg_all);
  const avgAllLen = Math.min(freqs.length, avgAll.length);
  if (avgAllLen > 0) {
    return {
      freqs: freqs.slice(0, avgAllLen),
      mags: avgAll.slice(0, avgAllLen),
    };
  }

  const left = numberList(data.left_mag_db_avg);
  const right = numberList(data.right_mag_db_avg);
  const lrLen = Math.min(freqs.length, left.length, right.length);
  if (lrLen > 0) {
    return {
      freqs: freqs.slice(0, lrLen),
      mags: left
        .slice(0, lrLen)
        .map((value, index) => (value + right[index]) / 2),
    };
  }

  const leftLen = Math.min(freqs.length, left.length);
  if (leftLen > 0) {
    return {
      freqs: freqs.slice(0, leftLen),
      mags: left.slice(0, leftLen),
    };
  }

  const rightLen = Math.min(freqs.length, right.length);
  if (rightLen > 0) {
    return {
      freqs: freqs.slice(0, rightLen),
      mags: right.slice(0, rightLen),
    };
  }

  return null;
}

function averageCurveList(curves: number[][]): number[] {
  if (curves.length === 0) {
    return [];
  }
  const length = curves[0].length;
  if (length === 0) {
    return [];
  }
  const sums = new Array<number>(length).fill(0);
  let rows = 0;
  for (const curve of curves) {
    if (curve.length < length) {
      continue;
    }
    for (let index = 0; index < length; index += 1) {
      sums[index] += curve[index];
    }
    rows += 1;
  }
  if (rows === 0) {
    return [];
  }
  return sums.map((sum) => sum / rows);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) {
    return 0;
  }
  const variance =
    values.reduce((acc, value) => {
      const delta = value - avg;
      return acc + delta * delta;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

function calibrationKeyForRequest(request: LatencyRequest): string {
  if (request.signal === "impulse") {
    return "impulse";
  }
  if (request.signal === "sine") {
    const frequency = request.frequencyHz;
    if (Math.abs(frequency - 1000) <= 20) {
      return "beep_1k";
    }
    if (Math.abs(frequency - 2000) <= 20) {
      return "beep_2k";
    }
    if (Math.abs(frequency - 5000) <= 50) {
      return "beep_5k";
    }
    if (Math.abs(frequency - 200) <= 5) {
      return "beep_200";
    }
    return `sine_${Math.round(frequency)}`;
  }
  return "pink_noise";
}

function calibrationOffsetForRequest(
  request: LatencyRequest,
  calibration: LatencyCalibration,
): number {
  const key = calibrationKeyForRequest(request);
  return calibration.perSoundOffsetsMs[key] ?? 0;
}

function applyLatencyCalibration(
  report: LatencyReport,
  request: LatencyRequest,
  calibration: LatencyCalibration,
): LatencyReport {
  const offset = calibrationOffsetForRequest(request, calibration);
  if (offset === 0) {
    return report;
  }

  const adjustedMeasurements = report.measurements.map((measurement) => ({
    ...measurement,
    delayMs: measurement.delayMs === null ? null : measurement.delayMs - offset,
  }));
  const values = adjustedMeasurements
    .map((measurement) => measurement.delayMs)
    .filter((value): value is number => value !== null);
  const average = values.length > 0 ? mean(values) : null;
  const std =
    values.length > 0 && average !== null ? stdDev(values, average) : null;

  return {
    ...report,
    measurements: adjustedMeasurements,
    averageDelayMs: average,
    stdDevMs: std,
  };
}

function requestForPreset(
  base: LatencyRequest,
  preset: LatencyPresetConfig,
  repeats?: number,
): LatencyRequest {
  return {
    ...base,
    signal: preset.signal,
    frequencyHz: preset.frequencyHz,
    repeats: repeats ?? base.repeats,
  };
}

function combineGuidedMonoSweepPayload(
  leftPayload: TestPayload,
  rightPayload: TestPayload,
): TestPayload {
  const leftParams = recordOrEmpty(leftPayload.params);
  const rightParams = recordOrEmpty(rightPayload.params);
  const leftMetrics = recordOrEmpty(leftPayload.metrics);
  const rightMetrics = recordOrEmpty(rightPayload.metrics);
  const leftData = recordOrEmpty(leftPayload.data);
  const rightData = recordOrEmpty(rightPayload.data);
  const leftFiles = recordOrEmpty(leftPayload.files);
  const rightFiles = recordOrEmpty(rightPayload.files);

  const leftAll = numberCurveList(leftData.left_mag_db_all);
  const rightAll = numberCurveList(rightData.right_mag_db_all);
  const combinedAll = [...leftAll, ...rightAll];
  const combinedAvg = averageCurveList(combinedAll);

  return {
    test: "sweep_fr",
    timestamp: rightPayload.timestamp,
    params: {
      ...leftParams,
      ...rightParams,
      mono_mode: true,
      mono_side: "guided_left_then_right",
    },
    metrics: {
      delay_ms_left: leftMetrics.delay_ms_left ?? null,
      delay_ms_right: rightMetrics.delay_ms_right ?? null,
    },
    data: {
      freqs: leftData.freqs ?? rightData.freqs ?? [],
      left_mag_db_avg: leftData.left_mag_db_avg ?? [],
      left_mag_db_all: leftAll,
      right_mag_db_avg: rightData.right_mag_db_avg ?? [],
      right_mag_db_all: rightAll,
      mag_db_all: combinedAll,
      mag_db_avg_all: combinedAvg,
    },
    files: {
      ...leftFiles,
      ...rightFiles,
    },
  };
}

export function usePawdioLabController() {
  const persistedUiState = useMemo(() => readPersistedUiState(), []);

  const [activePage, setActivePage] = useState<PageKey>(
    parsePageKey(persistedUiState?.activePage),
  );
  const [experimentalEnabled, setExperimentalEnabled] = useState(
    typeof persistedUiState?.experimentalEnabled === "boolean"
      ? persistedUiState.experimentalEnabled
      : true,
  );
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(
    mergeWithDefaults(defaultSettings, persistedUiState?.settings),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latencyRequest, setLatencyRequest] = useState<LatencyRequest>(
    mergeWithDefaults(defaultLatencyRequest, persistedUiState?.latencyRequest),
  );
  const [latencyProgress, setLatencyProgress] = useState<LatencyProgress[]>([]);
  const [latencyReport, setLatencyReport] = useState<LatencyReport | null>(
    null,
  );
  const [latencyExportSuite, setLatencyExportSuite] = useState<
    LatencyExportEntry[]
  >([]);
  const [latencyCalibration, setLatencyCalibration] =
    useState<LatencyCalibration>(defaultLatencyCalibration);

  const [sweepRequest, setSweepRequest] = useState<SweepRequest>(
    mergeWithDefaults(defaultSweepRequest, persistedUiState?.sweepRequest),
  );
  const [sweepLastResult, setSweepLastResult] = useState<TestPayload | null>(
    null,
  );
  const [inputMonitor, setInputMonitor] = useState<InputMonitorState>(
    DEFAULT_INPUT_MONITOR,
  );
  const [pinkNoisePlaying, setPinkNoisePlaying] = useState(false);

  type MonoConfirmState = {
    message: string;
    resolve: () => void;
    reject: (reason?: unknown) => void;
  };
  const [monoConfirmState, setMonoConfirmState] =
    useState<MonoConfirmState | null>(null);

  const [balanceRequest, setBalanceRequest] = useState(
    mergeWithDefaults(defaultBalanceRequest, persistedUiState?.balanceRequest),
  );
  const [crosstalkRequest, setCrosstalkRequest] = useState<CrosstalkRequest>(
    mergeWithDefaults(
      defaultCrosstalkRequest,
      persistedUiState?.crosstalkRequest,
    ),
  );
  const [thdRequest, setThdRequest] = useState<ThdRequest>(
    mergeWithDefaults(defaultThdRequest, persistedUiState?.thdRequest),
  );
  const [thdToneText, setThdToneText] = useState(
    typeof persistedUiState?.thdToneText === "string"
      ? persistedUiState.thdToneText
      : defaultThdRequest.tones.join(", "),
  );
  const [isolationRequest, setIsolationRequest] = useState<IsolationRequest>(
    mergeWithDefaults(
      defaultIsolationRequest,
      persistedUiState?.isolationRequest,
    ),
  );

  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const nextResultId = useRef(1);

  // Load results from filesystem on startup
  useEffect(() => {
    const loadDatabaseResults = async () => {
      // Collect all output directories from settings
      const outputDirs: string[] = [];
      if (latencyRequest.outputDir) {
        outputDirs.push(latencyRequest.outputDir);
      }
      if (sweepRequest.outputDir) {
        outputDirs.push(sweepRequest.outputDir);
      }
      
      if (outputDirs.length > 0) {
        const dbResults = await scanDatabaseFiles(outputDirs);
        if (dbResults.length > 0) {
          setResults(dbResults);
          appendLog(`[database] loaded ${dbResults.length} results from filesystem`);
        }
      }
    };
    
    loadDatabaseResults();
  }, []);

  const latencyProgressPercent = useMemo(() => {
    if (latencyProgress.length === 0) {
      return 0;
    }
    const latest = latencyProgress[latencyProgress.length - 1];
    return Math.floor((latest.current / latest.total) * 100);
  }, [latencyProgress]);

  const logText = useMemo(() => logs.join("\n"), [logs]);

  const resultText = useMemo(() => {
    return results
      .map((entry) => JSON.stringify(entry.payload, null, 2))
      .join("\n\n");
  }, [results]);

  const calibrationText = useMemo(() => {
    const ordered = LATENCY_PRESETS.map((preset) => {
      const value =
        latencyCalibration.perSoundOffsetsMs[preset.storageKey] ?? 0;
      return `- ${preset.label}: ${value.toFixed(2)}`;
    });
    return ["Per-sound baselines (ms):", ...ordered].join("\n");
  }, [latencyCalibration]);

  function appendLog(message: string) {
    const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, `[${stamp}] ${message}`]);
  }

  function appendResult(payload: TestPayload) {
    // Get device name from settings - prefer custom item name, fall back to device name
    let deviceName = "Unknown Device";
    if (settings) {
      // Use the custom item name if provided (this is what users type, e.g., "Headphones", "Speakers")
      if (settings.itemName && settings.itemName.trim()) {
        deviceName = settings.itemName.trim();
      } else if (inventory) {
        // Fall back to actual device name if no custom name provided
        const outputDevice = inventory.outputs.find(
          (d) => d.index === settings.outputDeviceIndex,
        );
        const inputDevice = inventory.inputs.find(
          (d) => d.index === settings.inputDeviceIndex,
        );
        if (outputDevice) {
          deviceName = outputDevice.name;
        } else if (inputDevice) {
          deviceName = inputDevice.name;
        }
      }
    }
    const entry: ResultEntry = {
      id: nextResultId.current++,
      payload,
      savedAt: Date.now(),
      deviceName,
    };
    setResults((prev) => [...prev, entry]);
    // Auto-save to persistent history
    addToHistory(entry);
    appendLog(`[${payload.test}] result recorded`);
    const fileEntries = Object.entries(payload.files ?? {});
    for (const [key, value] of fileEntries) {
      if (typeof value === "string" && value.length > 0) {
        appendLog(`[${payload.test}] ${key} -> ${value}`);
      }
    }
  }

  async function refreshRuntimeStatus() {
    try {
      const status = await invoke<RuntimeStatus>("get_runtime_status");
      setRunning(status.running);
    } catch {
      setRunning(false);
    }
  }

  async function loadState() {
    setError(null);
    try {
      const [devices, liveSettings] = await Promise.all([
        invoke<DeviceInventory>("list_audio_devices"),
        invoke<AudioSettings>("get_audio_settings"),
      ]);

      setInventory(devices);
      const merged = { ...liveSettings, ...settings };
      const outputIndices = new Set(
        devices.outputs.map((device) => device.index),
      );
      const inputIndices = new Set(
        devices.inputs.map((device) => device.index),
      );
      if (
        merged.outputDeviceIndex !== null &&
        !outputIndices.has(merged.outputDeviceIndex)
      ) {
        merged.outputDeviceIndex = null;
      }
      if (
        merged.inputDeviceIndex !== null &&
        !inputIndices.has(merged.inputDeviceIndex)
      ) {
        merged.inputDeviceIndex = null;
      }
      // Always update to current system defaults on device refresh
      if (devices.defaultOutputIndex !== null) {
        merged.outputDeviceIndex = devices.defaultOutputIndex;
      } else if (merged.outputDeviceIndex === null) {
        merged.outputDeviceIndex = null;
      }
      if (devices.defaultInputIndex !== null) {
        merged.inputDeviceIndex = devices.defaultInputIndex;
      } else if (merged.inputDeviceIndex === null) {
        merged.inputDeviceIndex = null;
      }
      const committed = await invoke<AudioSettings>("set_audio_settings", {
        settings: merged,
      });
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function commitSettings(next: AudioSettings) {
    const normalized = { ...next };
    if (inventory) {
      const outputIndices = new Set(
        inventory.outputs.map((device) => device.index),
      );
      const inputIndices = new Set(
        inventory.inputs.map((device) => device.index),
      );
      if (
        normalized.outputDeviceIndex !== null &&
        !outputIndices.has(normalized.outputDeviceIndex)
      ) {
        normalized.outputDeviceIndex = inventory.defaultOutputIndex ?? null;
      }
      if (
        normalized.inputDeviceIndex !== null &&
        !inputIndices.has(normalized.inputDeviceIndex)
      ) {
        normalized.inputDeviceIndex = inventory.defaultInputIndex ?? null;
      }
    }
    setSettings(normalized);
    try {
      const committed = await invoke<AudioSettings>("set_audio_settings", {
        settings: normalized,
      });
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function runPayloadTest(
    command: string,
    request: unknown,
    startLog: string,
  ) {
    if (running) {
      return;
    }
    try {
      await invoke("stop_input_monitor");
    } catch {
      // no-op
    }
    try {
      await invoke("stop_pink_noise");
    } catch {
      // no-op
    }
    setPinkNoisePlaying(false);
    setInputMonitor((prev) => ({
      ...prev,
      monitoring: false,
      status: "Monitoring stopped.",
    }));
    setRunning(true);
    setError(null);
    appendLog(startLog);

    try {
      const payload = await invoke<TestPayload>(command, { request });
      appendResult({
        ...payload,
        timestamp: legacyTimestamp(payload.timestamp),
      });
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function invokeLatencyRaw(
    request: LatencyRequest,
  ): Promise<LatencyReport> {
    return invoke<LatencyReport>("run_latency_test", { request });
  }

  async function runLatencyOnce(
    request: LatencyRequest,
    includeResult = true,
  ): Promise<LatencyRunResult> {
    const rawReport = await invokeLatencyRaw(request);
    const calibratedOffsetMs = calibrationOffsetForRequest(
      request,
      latencyCalibration,
    );
    const calibratedReport = applyLatencyCalibration(
      rawReport,
      request,
      latencyCalibration,
    );
    if (includeResult) {
      appendResult({
        test: "latency",
        timestamp: legacyTimestamp(calibratedReport.timestampUtc),
        params: {
          signal: request.signal,
          frequency_hz: request.frequencyHz,
          duration: request.durationSecs,
          repeats: request.repeats,
          amplitude: request.amplitude,
          record_margin: request.recordMarginSecs,
          calibrated_offset_ms: calibratedOffsetMs,
        },
        metrics: {
          average_delay_ms: calibratedReport.averageDelayMs,
          std_dev_ms: calibratedReport.stdDevMs,
          cancelled: calibratedReport.cancelled,
        },
        data: {
          sample_rate: calibratedReport.sampleRate,
          input_sample_rate: calibratedReport.inputSampleRate,
          measurements: calibratedReport.measurements,
        },
        files: {},
      });
    }
    return { report: calibratedReport, calibratedOffsetMs };
  }

  async function runLatencyTest() {
    if (running) {
      return;
    }
    try {
      await invoke("stop_input_monitor");
    } catch {
      // no-op
    }
    try {
      await invoke("stop_pink_noise");
    } catch {
      // no-op
    }
    setPinkNoisePlaying(false);
    setInputMonitor((prev) => ({
      ...prev,
      monitoring: false,
      status: "Monitoring stopped.",
    }));
    setRunning(true);
    setError(null);
    setLatencyProgress([]);
    setLatencyReport(null);
    setLatencyExportSuite([]);
    appendLog(`[latency] started (${latencyRequest.signal})`);

    try {
      const request = { ...latencyRequest };
      const { report, calibratedOffsetMs } = await runLatencyOnce(
        request,
        true,
      );
      setLatencyReport(report);
      setLatencyExportSuite([
        {
          request: { ...request, calibratedOffsetMs },
          report,
        },
      ]);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function runLatencyPresetSuite(presets: LatencyPresetConfig[]) {
    if (running) {
      return;
    }
    if (presets.length === 0) {
      appendLog("[latency] no presets selected");
      return;
    }

    try {
      await invoke("stop_input_monitor");
    } catch {
      // no-op
    }
    try {
      await invoke("stop_pink_noise");
    } catch {
      // no-op
    }
    setPinkNoisePlaying(false);
    setInputMonitor((prev) => ({
      ...prev,
      monitoring: false,
      status: "Monitoring stopped.",
    }));
    setRunning(true);
    setError(null);
    setLatencyProgress([]);
    setLatencyReport(null);
    setLatencyExportSuite([]);
    appendLog(`[latency] preset suite started (${presets.length})`);

    // Use a shared run tag so all presets land in the same output folder
    const sharedRunTag = exportTimestampTag();
    let sharedOutputDir: string | undefined;
    if (latencyRequest.outputDir) {
      sharedOutputDir = `${latencyRequest.outputDir}/latency_suite_${sharedRunTag}`;
      appendLog(`[latency] shared output directory -> ${sharedOutputDir}`);
    } else {
      appendLog(`[latency] shared run tag -> ${sharedRunTag}`);
    }

    try {
      const suiteEntries: LatencyExportEntry[] = [];
      for (const preset of presets) {
        const request = {
          ...requestForPreset(latencyRequest, preset),
          saveOverallBarChart: false,
          sharedOutputDir,
          sharedRunTag,
        };
        appendLog(`[latency] ${preset.label} started`);
        const { report, calibratedOffsetMs } = await runLatencyOnce(
          request,
          true,
        );
        setLatencyReport(report);
        suiteEntries.push({
          request: {
            ...request,
            saveOverallBarChart: latencyRequest.saveOverallBarChart,
            calibratedOffsetMs,
          },
          report,
        });
        if (report.cancelled) {
          appendLog("[latency] preset suite cancelled");
          break;
        }
      }
      setLatencyExportSuite(suiteEntries);
      if (latencyRequest.saveOverallBarChart && suiteEntries.length > 0) {
        try {
          const barPath = await invoke<string>(
            "save_latency_overall_bar_chart",
            {
              request: { ...latencyRequest, calibratedOffsetMs: 0 },
              suite: suiteEntries,
            },
          );
          appendLog(`[latency] overall bar chart saved -> ${barPath}`);
        } catch (barError) {
          appendLog(`[latency] overall bar chart failed: ${String(barError)}`);
        }
      }
      appendLog("[latency] preset suite completed");
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function runLatencySelectedTests(
    selectedUiKeys: Array<LatencyPresetConfig["uiKey"]>,
  ) {
    const selected = LATENCY_PRESETS.filter((preset) =>
      selectedUiKeys.includes(preset.uiKey),
    );
    await runLatencyPresetSuite(selected);
  }

  async function runLatencyAllTests() {
    await runLatencyPresetSuite(LATENCY_PRESETS);
  }

  async function calibrateLatencySelected(
    selectedUiKeys: Array<LatencyPresetConfig["uiKey"]>,
    repeats: number,
  ) {
    if (running) {
      return;
    }
    try {
      await invoke("stop_input_monitor");
    } catch {
      // no-op
    }
    try {
      await invoke("stop_pink_noise");
    } catch {
      // no-op
    }
    setPinkNoisePlaying(false);
    setInputMonitor((prev) => ({
      ...prev,
      monitoring: false,
      status: "Monitoring stopped.",
    }));
    setRunning(true);
    setError(null);
    appendLog(`[calibration] selected presets x${repeats}`);

    const updates: Record<string, number> = {};
    try {
      const selected = LATENCY_PRESETS.filter((preset) =>
        selectedUiKeys.includes(preset.uiKey),
      );
      for (const preset of selected) {
        const request = {
          ...requestForPreset(latencyRequest, preset, repeats),
          savePerSoundPlot: false,
          saveOverallBarChart: false,
        };
        appendLog(`[calibration] ${preset.label} measuring...`);
        const report = await invokeLatencyRaw(request);
        if (report.averageDelayMs !== null) {
          updates[preset.storageKey] = report.averageDelayMs;
          appendLog(
            `[calibration] ${preset.label} baseline = ${report.averageDelayMs.toFixed(2)} ms`,
          );
        } else {
          appendLog(`[calibration] ${preset.label} failed`);
        }
      }
      if (Object.keys(updates).length > 0) {
        setLatencyCalibration((prev) => ({
          ...prev,
          perSoundOffsetsMs: { ...prev.perSoundOffsetsMs, ...updates },
        }));
      }
      appendLog("[calibration] selected presets complete");
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function calibrateLatencyAllPresets(repeats: number) {
    await calibrateLatencySelected(
      LATENCY_PRESETS.map((preset) => preset.uiKey),
      repeats,
    );
  }

  async function invokeSweepFrRaw(
    request: SweepInvokeRequest,
  ): Promise<TestPayload> {
    return invoke<TestPayload>("run_sweep_fr_test", { request });
  }

  function requestMonoConfirm(message: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      setMonoConfirmState({ message, resolve, reject });
    });
  }

  function confirmMonoDialog() {
    if (monoConfirmState) {
      monoConfirmState.resolve();
      setMonoConfirmState(null);
    }
  }

  function cancelMonoDialog() {
    if (monoConfirmState) {
      monoConfirmState.reject(new Error("cancelled"));
      setMonoConfirmState(null);
    }
  }

  async function runSweepFrTest() {
    if (running) {
      return;
    }
    const monoGuided = sweepRequest.monoMode;
    if (monoGuided) {
      try {
        await requestMonoConfirm(
          "Mono mode: place the LEFT earphone/driver on the measurement position, then click OK to run the LEFT sweep.",
        );
      } catch {
        appendLog("[SWEEP FR] mono run cancelled before LEFT sweep");
        return;
      }
    }
    try {
      await invoke("stop_input_monitor");
    } catch {
      // no-op
    }
    try {
      await invoke("stop_pink_noise");
    } catch {
      // no-op
    }
    setPinkNoisePlaying(false);
    setInputMonitor((prev) => ({
      ...prev,
      monitoring: false,
      status: "Monitoring stopped.",
    }));
    setRunning(true);
    setError(null);
    appendLog(
      monoGuided
        ? "[SWEEP FR] mono guided run started (LEFT -> RIGHT)"
        : "[SWEEP FR] running",
    );
    try {
      if (!monoGuided) {
        const payload = await invokeSweepFrRaw(sweepRequest);
        const normalized = {
          ...payload,
          timestamp: legacyTimestamp(payload.timestamp),
        };
        setSweepLastResult(normalized);
        appendResult(normalized);
      } else {
        const sharedRunTag = exportTimestampTag();
        appendLog("[SWEEP FR] running LEFT sweep");
        const leftPayload = await invokeSweepFrRaw({
          ...sweepRequest,
          monoSide: "left",
          sharedRunTag,
        });
        appendLog("[SWEEP FR] LEFT sweep complete");

        setRunning(false);
        try {
          await requestMonoConfirm(
            "Now place the RIGHT earphone/driver on the measurement position, then click OK to run the RIGHT sweep.",
          );
        } catch {
          const leftOnly = {
            ...leftPayload,
            timestamp: legacyTimestamp(leftPayload.timestamp),
          };
          setSweepLastResult(leftOnly);
          appendResult(leftOnly);
          appendLog("[SWEEP FR] mono run stopped after LEFT sweep");
          return;
        }
        setRunning(true);

        appendLog("[SWEEP FR] running RIGHT sweep");
        const rightPayload = await invokeSweepFrRaw({
          ...sweepRequest,
          monoSide: "right",
          sharedRunTag,
        });
        const combinedPayload = combineGuidedMonoSweepPayload(
          leftPayload,
          rightPayload,
        );
        const normalized = {
          ...combinedPayload,
          timestamp: legacyTimestamp(combinedPayload.timestamp),
        };
        setSweepLastResult(normalized);
        appendResult(normalized);
        appendLog("[SWEEP FR] mono guided run completed");
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function startInputMonitor() {
    if (running) {
      appendLog("[monitor] cannot start while a test is running");
      return;
    }
    try {
      // Ensure any stale monitor stream is closed before starting a new one.
      try {
        await invoke("stop_input_monitor");
      } catch {
        // no-op
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 120);
      });
      await invoke("start_input_monitor");
      setInputMonitor((prev) => ({
        ...prev,
        monitoring: true,
        status: "Monitoring input...",
      }));
      appendLog("[monitor] started");
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function stopInputMonitor() {
    try {
      await invoke("stop_input_monitor");
      setInputMonitor((prev) => ({
        ...prev,
        monitoring: false,
        status: "Monitoring stopped.",
      }));
      appendLog("[monitor] stopped");
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function startPinkNoise() {
    if (running) {
      appendLog("[pink-noise] cannot start while a test is running");
      return;
    }
    try {
      try {
        await invoke("stop_pink_noise");
      } catch {
        // no-op
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 80);
      });
      await invoke("start_pink_noise");
      setPinkNoisePlaying(true);
      setInputMonitor((prev) => ({
        ...prev,
        status: prev.monitoring ? prev.status : "Playing pink noise...",
      }));
      appendLog("[pink-noise] started");
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function stopPinkNoise() {
    try {
      await invoke("stop_pink_noise");
      setPinkNoisePlaying(false);
      setInputMonitor((prev) => ({
        ...prev,
        status: prev.monitoring ? prev.status : "Pink noise stopped.",
      }));
      appendLog("[pink-noise] stopped");
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function resetInputMonitorPeak() {
    try {
      await invoke("reset_input_monitor_peak");
    } catch {
      // reset locally even if backend reset command is unavailable.
    }
    setInputMonitor((prev) => ({
      ...prev,
      peakDbfs: prev.currentDbfs,
      clipCount: 0,
    }));
  }

  async function runBalanceTest() {
    await runPayloadTest(
      "run_balance_test",
      balanceRequest,
      "[BALANCE] running",
    );
  }

  async function runCrosstalkTest() {
    await runPayloadTest(
      "run_crosstalk_test",
      crosstalkRequest,
      "[CROSSTALK] running",
    );
  }

  async function runThdTest() {
    const tones = parseToneList(thdToneText);
    if (tones.length === 0) {
      setError("THD tones are required. Example: 100, 1000, 6000");
      return;
    }
    const next = { ...thdRequest, tones };
    setThdRequest(next);
    await runPayloadTest("run_thd_test", next, "[THD] running");
  }

  async function runIsolationTest() {
    await runPayloadTest(
      "run_isolation_test",
      isolationRequest,
      "[ISOLATION] running",
    );
  }

  async function exportLatencyReport() {
    if (!latencyReport || latencyExportSuite.length === 0) {
      setError("No latency report to export yet.");
      return;
    }
    setError(null);
    try {
      const latest = latencyExportSuite[latencyExportSuite.length - 1];
      const path = await invoke<string>("export_latency_report", {
        request: latest.request,
        report: latest.report,
        suite: latencyExportSuite,
      });
      appendLog(`[latency] report saved -> ${path}`);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportSweepLastJson() {
    if (!sweepLastResult) {
      setError("No Sweep FR result to export yet.");
      return;
    }

    setError(null);
    try {
      const filename = `sweep_fr_last_${exportTimestampTag()}.json`;
      triggerDownload(
        `${JSON.stringify(sweepLastResult, null, 2)}\n`,
        filename,
        "application/json;charset=utf-8",
      );
      appendLog(`[sweep_fr] exported LAST JSON -> ${filename}`);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportSweepAllJson() {
    const sweepResults = results
      .map((entry) => entry.payload)
      .filter((payload) => payload.test === "sweep_fr");
    if (sweepResults.length === 0) {
      setError("No Sweep FR results to export yet.");
      return;
    }

    setError(null);
    try {
      const filename = `sweep_fr_all_${exportTimestampTag()}.json`;
      const bundle = {
        generatedAt: new Date().toISOString(),
        count: sweepResults.length,
        results: sweepResults,
      };
      triggerDownload(
        `${JSON.stringify(bundle, null, 2)}\n`,
        filename,
        "application/json;charset=utf-8",
      );
      appendLog(
        `[sweep_fr] exported ALL JSON (${sweepResults.length}) -> ${filename}`,
      );
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportSweepLastSquiglink() {
    if (!sweepLastResult) {
      setError("No Sweep FR result to export yet.");
      return;
    }

    const curve = sweepAverageCurve(sweepLastResult);
    if (!curve || curve.freqs.length === 0) {
      setError("Sweep FR result does not include exportable curve data.");
      return;
    }

    setError(null);
    try {
      const filename = `squiglink_avg_${exportTimestampTag()}.txt`;
      const lines = [
        "# PawdioLab Frequency Response - Average (L+R)",
        "# Frequency(Hz)\tAmplitude(dB)",
      ];
      for (let index = 0; index < curve.freqs.length; index += 1) {
        lines.push(
          `${curve.freqs[index].toFixed(2)}\t${curve.mags[index].toFixed(3)}`,
        );
      }
      triggerDownload(
        `${lines.join("\n")}\n`,
        filename,
        "text/plain;charset=utf-8",
      );
      appendLog(`[sweep_fr] exported LAST Squiglink -> ${filename}`);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportSweepLastCsv() {
    if (!sweepLastResult) {
      setError("No Sweep FR result to export yet.");
      return;
    }

    const data = recordOrEmpty(sweepLastResult.data);
    const freqs = numberList(data.freqs);
    if (freqs.length === 0) {
      setError("Sweep FR result does not include exportable curve data.");
      return;
    }

    setError(null);
    try {
      const filename = `sweep_fr_${exportTimestampTag()}.csv`;

      const leftAvg = numberList(data.left_mag_db_avg);
      const rightAvg = numberList(data.right_mag_db_avg);
      const leftAll = numberCurveList(data.left_mag_db_all);
      const rightAll = numberCurveList(data.right_mag_db_all);

      let header = "Frequency(Hz)";
      if (leftAvg.length > 0) header += ",Left_Avg(dB)";
      if (rightAvg.length > 0) header += ",Right_Avg(dB)";
      for (let i = 0; i < leftAll.length; i++)
        header += `,Left_Sweep_${i + 1}(dB)`;
      for (let i = 0; i < rightAll.length; i++)
        header += `,Right_Sweep_${i + 1}(dB)`;

      const lines = [header];

      const numRows = Math.min(
        freqs.length,
        leftAvg.length,
        rightAvg.length,
        ...leftAll.map((c) => c.length),
        ...rightAll.map((c) => c.length),
      );

      for (let i = 0; i < numRows; i++) {
        let row = freqs[i].toFixed(2);
        if (leftAvg.length > i) row += `,${leftAvg[i].toFixed(3)}`;
        if (rightAvg.length > i) row += `,${rightAvg[i].toFixed(3)}`;
        for (const curve of leftAll) {
          if (curve.length > i) row += `,${curve[i].toFixed(3)}`;
        }
        for (const curve of rightAll) {
          if (curve.length > i) row += `,${curve[i].toFixed(3)}`;
        }
        lines.push(row);
      }

      triggerDownload(
        `${lines.join("\n")}\n`,
        filename,
        "text/csv;charset=utf-8",
      );
      appendLog(`[sweep_fr] exported LAST CSV -> ${filename}`);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportLatencyCsv() {
    if (!latencyReport || latencyExportSuite.length === 0) {
      setError("No latency report to export yet.");
      return;
    }

    setError(null);
    try {
      const filename = `latency_${exportTimestampTag()}.csv`;
      const lines = [
        "Signal,Frequency(Hz),Iteration,Delay(ms),Average(ms),StdDev(ms)",
      ];

      for (const entry of latencyExportSuite) {
        const freq = entry.request.frequencyHz;
        const signal = entry.request.signal;

        for (const measurement of entry.report.measurements) {
          const delay =
            measurement.delayMs !== null ? measurement.delayMs.toFixed(3) : "";
          lines.push(`${signal},${freq},${measurement.iteration},${delay},,`);
        }

        if (entry.report.averageDelayMs !== null) {
          const avgIdx = lines.length - entry.report.measurements.length;
          const std = entry.report.stdDevMs?.toFixed(3) ?? "";
          lines[avgIdx] += `,${entry.report.averageDelayMs.toFixed(3)},${std}`;
        }
      }

      triggerDownload(
        `${lines.join("\n")}\n`,
        filename,
        "text/csv;charset=utf-8",
      );
      appendLog(`[latency] exported CSV -> ${filename}`);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function browseLatencyOutputFolder() {
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: latencyRequest.outputDir || undefined,
      });
      if (typeof selected === "string" && selected.length > 0) {
        setLatencyRequest((prev) => ({ ...prev, outputDir: selected }));
        appendLog(`[latency] output folder set -> ${selected}`);
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function browseSweepOutputFolder() {
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: sweepRequest.outputDir || undefined,
      });
      if (typeof selected === "string" && selected.length > 0) {
        setSweepRequest((prev) => ({ ...prev, outputDir: selected }));
        appendLog(`[sweep_fr] output folder set -> ${selected}`);
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function stopTest() {
    try {
      await invoke("stop_test");
      setPinkNoisePlaying(false);
      setInputMonitor((prev) => ({
        ...prev,
        monitoring: false,
        status: "Monitoring stopped.",
      }));
      appendLog("[runtime] stop requested");
    } catch (err) {
      setError(String(err));
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(logText);
      appendLog("[results] log copied");
    } catch (err) {
      setError(String(err));
    }
  }

  function clearLogs() {
    setLogs([]);
  }

  function clearResults() {
    setResults([]);
  }

  function deleteResult(id: number) {
    setResults((prev) => prev.filter((entry) => entry.id !== id));
  }

  function restoreResult(entry: ResultEntry) {
    setResults((prev) => [...prev, entry]);
  }

  useEffect(() => {
    loadState().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as LatencyCalibration;
      if (parsed && typeof parsed === "object") {
        setLatencyCalibration({
          perSoundOffsetsMs: parsed.perSoundOffsetsMs ?? {},
        });
      }
    } catch {
      // ignore invalid persisted calibration state
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        CALIBRATION_STORAGE_KEY,
        JSON.stringify(latencyCalibration),
      );
    } catch {
      // ignore storage write issues
    }
  }, [latencyCalibration]);

  useEffect(() => {
    if (!experimentalEnabled && activePage === "experimental") {
      setActivePage("latency");
    }
  }, [experimentalEnabled, activePage]);

  useEffect(() => {
    const snapshot: PersistedUiState = {
      activePage,
      experimentalEnabled,
      settings,
      latencyRequest,
      sweepRequest,
      balanceRequest,
      crosstalkRequest,
      thdRequest,
      thdToneText,
      isolationRequest,
    };
    try {
      localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage write issues
    }
  }, [
    activePage,
    experimentalEnabled,
    settings,
    latencyRequest,
    sweepRequest,
    balanceRequest,
    crosstalkRequest,
    thdRequest,
    thdToneText,
    isolationRequest,
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshRuntimeStatus().catch(() => undefined);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let offLatency: null | (() => void) = null;
    let offProgress: null | (() => void) = null;
    let offInput: null | (() => void) = null;

    listen<LatencyProgress>("latency-progress", (event) => {
      setLatencyProgress((prev) => [...prev, event.payload]);
    })
      .then((off) => {
        offLatency = off;
      })
      .catch((err) => setError(String(err)));

    listen<TestProgress>("test-progress", (event) => {
      appendLog(`[${event.payload.test}] ${event.payload.message}`);
      if (
        event.payload.test === "monitor" &&
        event.payload.message.toLowerCase().includes("error")
      ) {
        setInputMonitor((prev) => ({
          ...prev,
          monitoring: false,
          status: "Monitor error. Check input device/sample rate.",
        }));
      }
      if (
        event.payload.test === "pink_noise" &&
        event.payload.message.toLowerCase().includes("error")
      ) {
        setPinkNoisePlaying(false);
        setInputMonitor((prev) => ({
          ...prev,
          status: "Pink noise error. Check output device/sample rate.",
        }));
      }
    })
      .then((off) => {
        offProgress = off;
      })
      .catch((err) => setError(String(err)));

    listen<InputLevelEvent>("input-level", (event) => {
      const current = event.payload.currentDbfs;
      const peakFromBackend = event.payload.peakDbfs;
      const clips = event.payload.clipCount;
      setInputMonitor((prev) => {
        const peak = Math.max(prev.peakDbfs, current, peakFromBackend);
        return {
          ...prev,
          monitoring: true,
          status: "Monitoring input...",
          currentDbfs: current,
          peakDbfs: peak,
          clipCount: clips,
          splEstimate: current + 94,
          roughFrHz:
            Array.isArray(event.payload.roughFrHz) &&
            event.payload.roughFrHz.length > 0
              ? event.payload.roughFrHz
              : prev.roughFrHz,
          roughFrDb:
            Array.isArray(event.payload.roughFrDb) &&
            event.payload.roughFrDb.length > 0
              ? event.payload.roughFrDb
              : prev.roughFrDb,
        };
      });
    })
      .then((off) => {
        offInput = off;
      })
      .catch((err) => setError(String(err)));

    return () => {
      if (offLatency) {
        offLatency();
      }
      if (offProgress) {
        offProgress();
      }
      if (offInput) {
        offInput();
      }
    };
  }, []);

  return {
    activePage,
    setActivePage,
    experimentalEnabled,
    setExperimentalEnabled,
    inventory,
    settings,
    running,
    error,
    latencyRequest,
    setLatencyRequest,
    latencyProgress,
    latencyReport,
    latencyCalibration,
    calibrationText,
    sweepRequest,
    setSweepRequest,
    sweepLastResult,
    inputMonitor,
    pinkNoisePlaying,
    monoConfirmState,
    confirmMonoDialog,
    cancelMonoDialog,
    startInputMonitor,
    stopInputMonitor,
    startPinkNoise,
    stopPinkNoise,
    resetInputMonitorPeak,
    balanceRequest,
    setBalanceRequest,
    crosstalkRequest,
    setCrosstalkRequest,
    thdRequest,
    setThdRequest,
    thdToneText,
    setThdToneText,
    isolationRequest,
    setIsolationRequest,
    logs,
    results,
    logText,
    resultText,
    latencyProgressPercent,
    loadState,
    commitSettings,
    runLatencyTest,
    runLatencySelectedTests,
    runLatencyAllTests,
    calibrateLatencySelected,
    calibrateLatencyAllPresets,
    runSweepFrTest,
    runBalanceTest,
    runCrosstalkTest,
    runThdTest,
    runIsolationTest,
    exportLatencyReport,
    exportSweepLastJson,
    exportSweepAllJson,
    exportSweepLastSquiglink,
    exportSweepLastCsv,
    exportLatencyCsv,
    browseLatencyOutputFolder,
    browseSweepOutputFolder,
    stopTest,
    copyLogs,
    clearLogs,
    clearResults,
    deleteResult,
    restoreResult,
  };
}

export type PawdioLabController = ReturnType<typeof usePawdioLabController>;

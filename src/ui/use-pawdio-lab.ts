import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import * as ipc from "../ipc/commands";
import { useDebouncedPersist } from "./hooks/use-debounced-persist";
import { useMonitorAndNoise } from "./hooks/use-monitor-and-noise";
import { useResultsLog } from "./hooks/use-results-log";
import { useDevicesController } from "./hooks/use-devices-controller";
import { useLibrary } from "./hooks/use-library";
import { useToast } from "./components/toast";
import { downloadText, exportTimestampTag } from "./lib/export-files";
import { combineAcceptedSweepPayloads } from "./lib/sweep-results";
import {
  ANC_MODE_META,
  ANC_MODE_ORDERED,
  AncCaptures,
  AncModeKey,
  AncRequest,
  AncSnapshot,
  AudioSettings,
  CrosstalkRequest,
  DeviceInventory,
  IsolationRequest,
  LatencyCalibration,
  LatencyProgress,
  LatencyReport,
  LatencyRequest,
  PageKey,
  SweepRequest,
  TestPayload,
  TestProgress,
  ThdRequest,
  defaultAncRequest,
  defaultBalanceRequest,
  defaultCrosstalkRequest,
  defaultIsolationRequest,
  defaultLatencyCalibration,
  defaultLatencyRequest,
  defaultSettings,
  defaultSweepRequest,
  defaultThdRequest,
  legacyTimestamp,
  parsePageKey,
  parseToneList,
} from "./model";

// Type for database entries from Rust backend
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

const CALIBRATION_STORAGE_KEY = "pawdio-lab-latency-calibration-v1";
const UI_STATE_STORAGE_KEY = "pawdio-lab-ui-state-v1";
// Long runs emit one latency-progress event per repeat; cap retained rows so
// the array cannot grow without bound across many runs.
const MAX_LATENCY_PROGRESS_ROWS = 1000;

const logCaughtError =
  (label: string) =>
  (err: unknown): undefined => {
    console.warn(`[pawdio-lab] ${label}:`, err);
    return undefined;
  };

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

type PersistedUiState = {
  activePage?: PageKey;
  experimentalEnabled?: boolean;
  settings?: Partial<AudioSettings>;
  latencyRequest?: Partial<LatencyRequest>;
  sweepRequest?: Partial<SweepRequest>;
  ancRequest?: Partial<AncRequest>;
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

type SweepMonoSide = "left" | "right" | "both";
type SweepInvokeRequest = SweepRequest & { monoSide?: SweepMonoSide };

type SweepCaptureSide = "stereo" | "left" | "right";

type SweepReviewState = {
  payload: TestPayload;
  side: SweepCaptureSide;
  attempt: number;
  accepted: number;
  target: number;
  resolve: (accepted: boolean) => void;
};

type SweepRunProgress = {
  side: SweepCaptureSide | "complete";
  accepted: number;
  target: number;
  attempts: number;
  phase: "capturing" | "reviewing" | "complete";
};

type SweepLastResultStatus = "pending" | "accepted" | "rejected" | "final";

type AncCaptureSide = "both" | "left" | "right";
type AncStep = { mode: AncModeKey; side: AncCaptureSide };

/**
 * Fold a single-side (or stereo) snapshot into the running capture for a mode.
 * Guided mono captures arrive one side at a time, so left-only snapshots keep
 * the previously captured right channel (and vice versa).
 */
function mergeAncSideSnapshot(
  existing: AncSnapshot | undefined,
  side: AncCaptureSide,
  snap: AncSnapshot,
): AncSnapshot {
  if (side === "both" || !existing) {
    return side === "left"
      ? { ...snap, magDbRight: existing?.magDbRight ?? [] }
      : side === "right"
        ? { ...snap, magDbLeft: existing?.magDbLeft ?? [] }
        : snap;
  }
  return side === "left"
    ? {
        freqs: snap.freqs.length ? snap.freqs : existing.freqs,
        magDbLeft: snap.magDbLeft,
        magDbRight: existing.magDbRight,
        timestamp: snap.timestamp,
      }
    : {
        freqs: snap.freqs.length ? snap.freqs : existing.freqs,
        magDbLeft: existing.magDbLeft,
        magDbRight: snap.magDbRight,
        timestamp: snap.timestamp,
      };
}

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

/**
 * Derive a sibling file path by replacing a token in the final path segment
 * (basename) only. Returns undefined when the basename does not contain the
 * token, so callers never fabricate a path from a filename that doesn't match.
 * Scoping the replacement to the basename avoids clobbering an earlier
 * directory segment that happens to contain the same token.
 */
function siblingPathByBasename(
  path: string,
  search: string,
  replacement: string,
): string | undefined {
  const sepIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = sepIndex >= 0 ? path.slice(0, sepIndex + 1) : "";
  const base = sepIndex >= 0 ? path.slice(sepIndex + 1) : path;
  if (!base.includes(search)) {
    return undefined;
  }
  return `${dir}${base.replace(search, replacement)}`;
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Surface every new error as a toast; the persistent error card in the shell
  // remains the detail view.
  useEffect(() => {
    if (error) toast(error, { kind: "error" });
  }, [error, toast]);

  // Devices + audio settings (extracted to hooks/use-devices-controller.ts)
  const { inventory, settings, loadState, commitSettings } =
    useDevicesController({
      initialSettings: mergeWithDefaults(
        defaultSettings,
        persistedUiState?.settings,
      ),
      setError: (m) => setError(m),
    });

  // Refs so the extracted result/monitor hooks see latest settings/inventory
  // without re-instantiating their state each render.
  const settingsRef = useRef<AudioSettings | null>(null);
  const inventoryRef = useRef<DeviceInventory | null>(null);
  settingsRef.current = settings;
  inventoryRef.current = inventory;

  // Logs + results buffer (extracted to hooks/use-results-log.ts)
  const {
    logs,
    results,
    logText,
    appendLog,
    appendResult,
    copyLogs,
    clearLogs,
  } = useResultsLog({
    getSettings: () => settingsRef.current,
    getInventory: () => inventoryRef.current,
  });

  // Measurement library (SQLite-backed; hooks/use-library.ts)
  const library = useLibrary({
    setError: (m) => setError(m),
    notify: (m) => toast(m, { kind: "success" }),
  });

  const [latencyRequest, setLatencyRequest] = useState<LatencyRequest>(
    mergeWithDefaults(defaultLatencyRequest, persistedUiState?.latencyRequest),
  );
  const [latencyProgress, setLatencyProgress] = useState<LatencyProgress[]>([]);
  const [lastTestProgress, setLastTestProgress] = useState<TestProgress | null>(
    null,
  );
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

  const [ancRequest, setAncRequest] = useState<AncRequest>(
    mergeWithDefaults(defaultAncRequest, persistedUiState?.ancRequest),
  );
  const [sweepLastResult, setSweepLastResult] = useState<TestPayload | null>(
    null,
  );
  const [sweepLastResultStatus, setSweepLastResultStatus] =
    useState<SweepLastResultStatus | null>(null);
  const [sweepReviewState, setSweepReviewState] =
    useState<SweepReviewState | null>(null);
  const [sweepRunProgress, setSweepRunProgress] =
    useState<SweepRunProgress | null>(null);
  const [sweepSessionActive, setSweepSessionActive] = useState(false);
  const sweepSessionActiveRef = useRef(false);
  // Input monitor + pink noise (extracted to hooks/use-monitor-and-noise.ts)
  const {
    inputMonitor,
    setInputMonitor,
    pinkNoisePlaying,
    setPinkNoisePlaying,
    startInputMonitor,
    stopInputMonitor,
    startPinkNoise,
    stopPinkNoise,
    resetInputMonitorPeak,
  } = useMonitorAndNoise({
    isRunning: () => running,
    appendLog: (m) => appendLog(m),
    setError: (m) => setError(m),
  });

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

  const [ancSelectedModes, setAncSelectedModes] = useState<AncModeKey[]>([
    "reference",
    "anc",
  ]);
  const [ancCaptures, setAncCaptures] = useState<AncCaptures>({});
  // A step is one capture: a mode, plus which side(s) to record. Stereo order
  // yields one `both` step per mode; left/right-first orders expand each mode
  // into two single-side steps so a single mic can be moved between ears.
  const [ancRunQueue, setAncRunQueue] = useState<AncStep[]>([]);
  const [ancCurrentStep, setAncCurrentStep] = useState<AncStep | null>(null);
  const [ancTotalSteps, setAncTotalSteps] = useState(0);
  const [ancStepPrompt, setAncStepPrompt] = useState(false);

  // logs, results, logText, appendLog, appendResult, copyLogs, clearLogs are
  // provided by useResultsLog (see top of hook).

  const latencyProgressPercent = useMemo(() => {
    if (latencyProgress.length === 0) {
      return 0;
    }
    const latest = latencyProgress[latencyProgress.length - 1];
    return Math.floor((latest.current / latest.total) * 100);
  }, [latencyProgress]);

  const calibrationText = useMemo(() => {
    const ordered = LATENCY_PRESETS.map((preset) => {
      const value =
        latencyCalibration.perSoundOffsetsMs[preset.storageKey] ?? 0;
      return `- ${preset.label}: ${value.toFixed(2)}`;
    });
    return ["Per-sound baselines (ms):", ...ordered].join("\n");
  }, [latencyCalibration]);

  // appendLog and appendResult come from useResultsLog (top of hook).

  async function refreshRuntimeStatus() {
    try {
      const status = await ipc.getRuntimeStatus();
      setRunning(status.running || sweepSessionActiveRef.current);
    } catch {
      setRunning(sweepSessionActiveRef.current);
    }
  }

  // loadState and commitSettings come from useDevicesController (top of hook).

  async function runPayloadTest(
    command:
      | "run_sweep_fr_test"
      | "run_thd_test"
      | "run_balance_test"
      | "run_crosstalk_test"
      | "run_isolation_test",
    request: unknown,
    startLog: string,
  ) {
    if (running) {
      return;
    }
    try {
      await ipc.stopInputMonitor();
    } catch {
      // no-op
    }
    try {
      await ipc.stopPinkNoise();
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
      const payload = await ipc.runPayloadTestRaw(command, request);
      appendResult({
        ...payload,
        timestamp: legacyTimestamp(payload.timestamp),
      });
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }
  }

  async function invokeLatencyRaw(
    request: LatencyRequest,
  ): Promise<LatencyReport> {
    return ipc.runLatencyTest(request);
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
      await ipc.stopInputMonitor();
    } catch {
      // no-op
    }
    try {
      await ipc.stopPinkNoise();
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
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
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
      await ipc.stopInputMonitor();
    } catch {
      // no-op
    }
    try {
      await ipc.stopPinkNoise();
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
          const barPath = await ipc.saveLatencyOverallBarChart(
            { ...latencyRequest, calibratedOffsetMs: 0 },
            suiteEntries,
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
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
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
      await ipc.stopInputMonitor();
    } catch {
      // no-op
    }
    try {
      await ipc.stopPinkNoise();
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
      toast("Calibration complete", { kind: "success" });
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
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
    return ipc.runSweepFrTest(request);
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

  function requestSweepReview(
    payload: TestPayload,
    side: SweepCaptureSide,
    attempt: number,
    accepted: number,
    target: number,
  ): Promise<boolean> {
    setSweepLastResult(payload);
    setSweepLastResultStatus("pending");
    setSweepRunProgress((progress) => ({
      side,
      accepted,
      target,
      attempts: progress?.attempts ?? attempt,
      phase: "reviewing",
    }));
    return new Promise<boolean>((resolve) => {
      setSweepReviewState({
        payload,
        side,
        attempt,
        accepted,
        target,
        resolve,
      });
    });
  }

  function resolveSweepReview(accepted: boolean) {
    if (!sweepReviewState) return;
    const review = sweepReviewState;
    setSweepLastResultStatus(accepted ? "accepted" : "rejected");
    setSweepReviewState(null);
    review.resolve(accepted);
  }

  function acceptSweepReview() {
    resolveSweepReview(true);
  }

  function rejectSweepReview() {
    resolveSweepReview(false);
  }

  async function rewriteAcceptedSweepArtifacts(
    payload: TestPayload,
  ): Promise<TestPayload> {
    const files = recordOrEmpty(payload.files);
    const data = recordOrEmpty(payload.data);
    const freqs = numberList(data.freqs);
    const leftAvg = numberList(data.left_mag_db_avg);
    const rightAvg = numberList(data.right_mag_db_avg);
    const allCurves = numberCurveList(data.mag_db_all);
    const avgAll = numberList(data.mag_db_avg_all);
    const extraFiles: Record<string, string> = {};

    const existingBoth =
      typeof files.squiglink_both === "string" ? files.squiglink_both : "";
    const leftSquiglink =
      typeof files.squiglink_left === "string" ? files.squiglink_left : "";
    const bothSquiglink =
      existingBoth ||
      (leftSquiglink
        ? siblingPathByBasename(
            leftSquiglink,
            "squiglink_left_",
            "squiglink_both_",
          )
        : undefined);
    if (
      bothSquiglink &&
      freqs.length > 0 &&
      leftAvg.length > 0 &&
      rightAvg.length > 0
    ) {
      await ipc
        .writeSquiglinkCombined({
          outputPath: bothSquiglink,
          freqs,
          leftDb: leftAvg,
          rightDb: rightAvg,
        })
        .catch(logCaughtError("writeSquiglinkCombined"));
      extraFiles.squiglink_both = bothSquiglink;
    }

    const allPlotPath =
      typeof files.plot_all === "string" ? files.plot_all : "";
    const avgAllPlotPath =
      typeof files.plot_avg_all === "string" ? files.plot_avg_all : "";
    const existingLrPath =
      typeof files.plot_lr_avg === "string" ? files.plot_lr_avg : "";
    const lrAvgPlotPath =
      existingLrPath ||
      (allPlotPath
        ? siblingPathByBasename(
            allPlotPath,
            "sweep_fr_all_",
            "sweep_fr_lr_avg_",
          )
        : undefined);
    if (freqs.length > 0 && (allPlotPath || avgAllPlotPath || lrAvgPlotPath)) {
      const written = await ipc
        .saveSweepCombinedPlots({
          allPlotPath: allPlotPath || undefined,
          avgAllPlotPath: avgAllPlotPath || undefined,
          lrAvgPlotPath,
          freqs,
          allCurves,
          avgAll,
          leftAvg,
          rightAvg,
        })
        .then(() => true)
        .catch((err) => {
          logCaughtError("saveSweepCombinedPlots")(err);
          return false;
        });
      if (written && lrAvgPlotPath && leftAvg.length && rightAvg.length) {
        extraFiles.plot_lr_avg = lrAvgPlotPath;
      }
    }

    return Object.keys(extraFiles).length > 0
      ? { ...payload, files: { ...payload.files, ...extraFiles } }
      : payload;
  }

  async function runSweepFrTest() {
    if (running || sweepSessionActiveRef.current) {
      return;
    }
    sweepSessionActiveRef.current = true;
    setSweepSessionActive(true);
    setRunning(true);
    // captureOrder is the source of truth; fall back to the legacy monoMode flag
    // for state persisted before the 3-way control existed.
    const order =
      sweepRequest.captureOrder ??
      (sweepRequest.monoMode ? "left_first" : "stereo");
    const guided = order !== "stereo";
    const firstSide: "left" | "right" =
      order === "right_first" ? "right" : "left";
    const secondSide: "left" | "right" =
      firstSide === "left" ? "right" : "left";
    const sideWord = (side: "left" | "right") =>
      side === "left" ? "LEFT" : "RIGHT";
    const target = Math.max(1, Math.round(sweepRequest.repeats));
    const sharedRunTag = exportTimestampTag();
    let totalAttempts = 0;

    async function collectAcceptedSweeps(
      side: SweepCaptureSide,
    ): Promise<TestPayload[]> {
      const acceptedPayloads: TestPayload[] = [];
      let sideAttempts = 0;
      while (acceptedPayloads.length < target) {
        sideAttempts += 1;
        totalAttempts += 1;
        setSweepRunProgress({
          side,
          accepted: acceptedPayloads.length,
          target,
          attempts: totalAttempts,
          phase: "capturing",
        });
        const sideLabel = side === "stereo" ? "STEREO" : sideWord(side);
        appendLog(
          `[SWEEP FR] ${sideLabel} attempt ${sideAttempts}; ${acceptedPayloads.length}/${target} accepted`,
        );
        const payload = await invokeSweepFrRaw({
          ...sweepRequest,
          repeats: 1,
          monoMode: side !== "stereo",
          monoSide: side === "stereo" ? undefined : side,
          sharedRunTag,
        });
        const normalized = {
          ...payload,
          timestamp: legacyTimestamp(payload.timestamp),
        };
        const accepted = await requestSweepReview(
          normalized,
          side,
          sideAttempts,
          acceptedPayloads.length,
          target,
        );
        if (accepted) {
          acceptedPayloads.push(normalized);
          appendLog(
            `[SWEEP FR] ${sideLabel} sweep accepted (${acceptedPayloads.length}/${target})`,
          );
        } else {
          appendLog(
            `[SWEEP FR] ${sideLabel} sweep discarded; accepted count remains ${acceptedPayloads.length}/${target}`,
          );
        }
        setSweepRunProgress({
          side,
          accepted: acceptedPayloads.length,
          target,
          attempts: totalAttempts,
          phase: "capturing",
        });
      }
      return acceptedPayloads;
    }

    setSweepRunProgress(null);
    if (guided) {
      try {
        await requestMonoConfirm(
          `Mono mode: place the ${sideWord(firstSide)} earphone/driver on the measurement position, then click OK to run the ${sideWord(firstSide)} sweep.`,
        );
      } catch {
        appendLog(
          `[SWEEP FR] mono run cancelled before ${sideWord(firstSide)} sweep`,
        );
        sweepSessionActiveRef.current = false;
        setSweepSessionActive(false);
        setRunning(false);
        return;
      }
    }
    try {
      await ipc.stopInputMonitor();
    } catch {
      // no-op
    }
    try {
      await ipc.stopPinkNoise();
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
      guided
        ? `[SWEEP FR] mono guided run started (${sideWord(firstSide)} -> ${sideWord(secondSide)})`
        : "[SWEEP FR] running",
    );
    try {
      let acceptedPayloads: TestPayload[];
      if (!guided) {
        acceptedPayloads = await collectAcceptedSweeps("stereo");
      } else {
        const firstAccepted = await collectAcceptedSweeps(firstSide);
        const firstSideResult = combineAcceptedSweepPayloads(firstAccepted, {
          acceptedPerSide: target,
          attempts: totalAttempts,
          captureOrder: order,
        });
        setSweepLastResult(firstSideResult);
        setSweepLastResultStatus("accepted");

        try {
          await requestMonoConfirm(
            `${target} ${sideWord(firstSide)} sweeps accepted. Move the measurement position to the ${sideWord(secondSide)} earphone/driver, then click OK.`,
          );
        } catch {
          setSweepRunProgress({
            side: firstSide,
            accepted: target,
            target,
            attempts: totalAttempts,
            phase: "complete",
          });
          appendLog(
            `[SWEEP FR] mono run stopped after ${target} accepted ${sideWord(firstSide)} sweeps; no final result recorded`,
          );
          return;
        }
        const secondAccepted = await collectAcceptedSweeps(secondSide);
        acceptedPayloads = [...firstAccepted, ...secondAccepted];
      }

      let acceptedResult = combineAcceptedSweepPayloads(acceptedPayloads, {
        acceptedPerSide: target,
        attempts: totalAttempts,
        captureOrder: order,
      });
      acceptedResult = await rewriteAcceptedSweepArtifacts(acceptedResult);
      setSweepLastResult(acceptedResult);
      setSweepLastResultStatus("final");
      appendResult(acceptedResult);
      setSweepRunProgress({
        side: "complete",
        accepted: target,
        target,
        attempts: totalAttempts,
        phase: "complete",
      });
      appendLog(
        guided
          ? `[SWEEP FR] mono guided run completed with ${target} accepted sweeps per side`
          : `[SWEEP FR] completed with ${target} accepted sweeps`,
      );
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      setSweepReviewState(null);
      sweepSessionActiveRef.current = false;
      setSweepSessionActive(false);
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }
  }

  // startInputMonitor / stopInputMonitor / startPinkNoise / stopPinkNoise /
  // resetInputMonitorPeak come from useMonitorAndNoise (top of hook).

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
      const path = await ipc.exportLatencyReport(
        latest.request,
        latest.report,
        latencyExportSuite,
      );
      appendLog(`[latency] report saved -> ${path}`);
      toast(`Latency report saved to ${path}`, { kind: "success" });
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportTextFile(
    outputDir: string,
    filename: string,
    content: string,
    mimeType: string,
  ): Promise<string> {
    if (outputDir.trim()) {
      return ipc.writeTextExport({ outputDir, filename, content });
    }
    downloadText(content, filename, mimeType);
    return filename;
  }

  async function exportSweepLastJson() {
    if (!sweepLastResult) {
      setError("No Sweep FR result to export yet.");
      return;
    }

    setError(null);
    try {
      const filename = `sweep_fr_last_${exportTimestampTag()}.json`;
      const path = await exportTextFile(
        sweepRequest.outputDir,
        filename,
        `${JSON.stringify(sweepLastResult, null, 2)}\n`,
        "application/json;charset=utf-8",
      );
      appendLog(`[sweep_fr] exported LAST JSON -> ${path}`);
      toast(`Exported ${path}`, { kind: "success" });
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
      const path = await exportTextFile(
        sweepRequest.outputDir,
        filename,
        `${JSON.stringify(bundle, null, 2)}\n`,
        "application/json;charset=utf-8",
      );
      appendLog(
        `[sweep_fr] exported ALL JSON (${sweepResults.length}) -> ${path}`,
      );
      toast(`Exported ${path}`, { kind: "success" });
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
      const path = await exportTextFile(
        sweepRequest.outputDir,
        filename,
        `${lines.join("\n")}\n`,
        "text/plain;charset=utf-8",
      );
      appendLog(`[sweep_fr] exported LAST Squiglink -> ${path}`);
      toast(`Exported ${path}`, { kind: "success" });
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

      const path = await exportTextFile(
        sweepRequest.outputDir,
        filename,
        `${lines.join("\n")}\n`,
        "text/csv;charset=utf-8",
      );
      appendLog(`[sweep_fr] exported LAST CSV -> ${path}`);
      toast(`Exported ${path}`, { kind: "success" });
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

      const path = await exportTextFile(
        latencyRequest.outputDir,
        filename,
        `${lines.join("\n")}\n`,
        "text/csv;charset=utf-8",
      );
      appendLog(`[latency] exported CSV -> ${path}`);
      toast(`Exported ${path}`, { kind: "success" });
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

  function startAncFlow() {
    const modes = ANC_MODE_ORDERED.filter((m) => ancSelectedModes.includes(m));
    if (modes.length === 0) return;
    const order = ancRequest.captureOrder ?? "stereo";
    let steps: AncStep[];
    if (order === "stereo") {
      steps = modes.map((mode) => ({ mode, side: "both" as const }));
    } else {
      const first: AncCaptureSide = order === "right_first" ? "right" : "left";
      const second: AncCaptureSide = first === "left" ? "right" : "left";
      steps = modes.flatMap((mode) => [
        { mode, side: first },
        { mode, side: second },
      ]);
    }
    if (steps.length === 0) return;
    setAncTotalSteps(steps.length);
    setAncRunQueue(steps.slice(1));
    setAncCurrentStep(steps[0]);
    setAncStepPrompt(true);
  }

  async function confirmAncStep() {
    if (!ancCurrentStep) return;
    const { mode, side } = ancCurrentStep;
    const isLastStep = ancRunQueue.length === 0;
    // Keep the step modal open and flag the run so its in-progress ("Recording…")
    // state shows immediately, rather than waiting on the 1s runtime-status poll.
    // The prompt advances to the next step once the capture resolves (below).
    setRunning(true);
    try {
      const result = await ipc.captureAncSnapshot({
        f0: ancRequest.f0,
        f1: ancRequest.f1,
        durationSecs: ancRequest.durationSecs,
        repeats: ancRequest.repeats,
        amplitude: ancRequest.amplitude,
        captureSide: side,
      });
      const merged = mergeAncSideSnapshot(ancCaptures[mode], side, result);
      const newCaptures = { ...ancCaptures, [mode]: merged };
      setAncCaptures(newCaptures);
      appendLog(`[anc] captured ${mode} (${side}) @ ${result.timestamp}`);

      // Auto-export when the last mode is captured and an output dir is set
      if (isLastStep && ancRequest.outputDir && ancRequest.savePlots) {
        const baselineKey = ANC_MODE_ORDERED.find(
          (m) => newCaptures[m] !== undefined,
        );
        const baseline = baselineKey ? newCaptures[baselineKey] : undefined;
        if (baseline && baselineKey) {
          const exportable = ANC_MODE_ORDERED.filter(
            (m) => m !== baselineKey && newCaptures[m] !== undefined,
          );
          if (exportable.length > 0) {
            await exportAncPlots(
              baseline,
              exportable.map((key) => ({
                key,
                label: ANC_MODE_META[key].label,
                snapshot: newCaptures[key]!,
              })),
            );
            for (const key of exportable) {
              await exportAncSquiglink(
                baseline,
                key,
                ANC_MODE_META[key].label,
                newCaptures[key]!,
              );
            }
          }
        }
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[anc] error: ${String(err)}`);
    } finally {
      setRunning(false);
    }
    setAncRunQueue((q) => {
      const next = q[0] ?? null;
      setAncCurrentStep(next);
      setAncStepPrompt(next !== null);
      return q.slice(1);
    });
  }

  function cancelAncFlow() {
    setAncCurrentStep(null);
    setAncRunQueue([]);
    setAncTotalSteps(0);
    setAncStepPrompt(false);
  }

  function resetAncCaptures() {
    setAncCaptures({});
    cancelAncFlow();
  }

  async function browseAncOutputFolder() {
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: ancRequest.outputDir || undefined,
      });
      if (typeof selected === "string" && selected.length > 0) {
        setAncRequest((prev) => ({ ...prev, outputDir: selected }));
        appendLog(`[anc] output folder set -> ${selected}`);
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function exportAncPlots(
    baseline: AncSnapshot,
    modesToExport: Array<{
      key: AncModeKey;
      label: string;
      snapshot: AncSnapshot;
    }>,
  ) {
    if (!ancRequest.outputDir) {
      appendLog("[anc] no output dir set — skipping plot export");
      return;
    }
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      // negative = cancelled (active quieter than baseline)
      const modes = modesToExport.map(({ key, label, snapshot }) => ({
        key,
        label,
        attenuationLeft: snapshot.magDbLeft.map(
          (a, i) => a - baseline.magDbLeft[i],
        ),
        attenuationRight: snapshot.magDbRight.map(
          (a, i) => a - baseline.magDbRight[i],
        ),
      }));
      await ipc.saveAncPlots({
        outputDir: ancRequest.outputDir,
        timestamp,
        freqs: baseline.freqs,
        modes,
      });
      appendLog(`[anc] plots saved to ${ancRequest.outputDir}`);
      toast(`ANC plots saved to ${ancRequest.outputDir}`, { kind: "success" });
    } catch (err) {
      setError(String(err));
      appendLog(`[anc] export error: ${String(err)}`);
    }
  }

  async function exportAncSquiglink(
    baseline: AncSnapshot,
    modeKey: AncModeKey,
    modeLabel: string,
    snapshot: AncSnapshot,
  ) {
    if (!ancRequest.outputDir) {
      appendLog("[anc] no output dir set");
      return;
    }
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      // Squiglink is single-channel: prefer the left curve, but fall back to the
      // right when a guided right-only capture left magDbLeft empty — otherwise
      // the exported file would have no data.
      const useRight =
        snapshot.magDbLeft.length === 0 || baseline.magDbLeft.length === 0;
      const aArr = useRight ? snapshot.magDbRight : snapshot.magDbLeft;
      const bArr = useRight ? baseline.magDbRight : baseline.magDbLeft;
      const attenuationDb = aArr.map((a, i) => a - (bArr[i] ?? NaN));
      const outputPath = `${ancRequest.outputDir}/anc_${modeKey}_${timestamp}.txt`;
      await ipc.saveAncSquiglink({
        outputPath,
        modeLabel,
        freqs: baseline.freqs,
        attenuationDb,
      });
      appendLog(`[anc] squiglink saved: anc_${modeKey}_${timestamp}.txt`);
      toast(`Saved anc_${modeKey}_${timestamp}.txt`, { kind: "success" });
    } catch (err) {
      setError(String(err));
      appendLog(`[anc] squiglink error: ${String(err)}`);
    }
  }

  async function stopTest() {
    try {
      await ipc.stopTest();
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
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }
  }

  // copyLogs and clearLogs come from useResultsLog (top of hook).

  useEffect(() => {
    loadState().catch((err) => setError(String(err)));
    library.loadLibrary();
    // Intentional init-only effect: runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Debounced persistence: rapid bursts (slider drags, keystrokes) coalesce into
  // one localStorage write 250ms after the last change.
  useDebouncedPersist(CALIBRATION_STORAGE_KEY, latencyCalibration);

  useEffect(() => {
    if (!experimentalEnabled && activePage === "experimental") {
      setActivePage("latency");
    }
  }, [experimentalEnabled, activePage]);

  const persistedUiSnapshot = useMemo<PersistedUiState>(
    () => ({
      activePage,
      experimentalEnabled,
      settings,
      latencyRequest,
      sweepRequest,
      ancRequest,
      balanceRequest,
      crosstalkRequest,
      thdRequest,
      thdToneText,
      isolationRequest,
    }),
    [
      activePage,
      experimentalEnabled,
      settings,
      latencyRequest,
      sweepRequest,
      ancRequest,
      balanceRequest,
      crosstalkRequest,
      thdRequest,
      thdToneText,
      isolationRequest,
    ],
  );
  useDebouncedPersist(UI_STATE_STORAGE_KEY, persistedUiSnapshot);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Use a cancelled flag so cleanup works even if unmount races with listener attach
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    async function attachListeners() {
      try {
        const offLatency = await listen<LatencyProgress>(
          "latency-progress",
          (event) => {
            setLatencyProgress((prev) => [
              ...prev.slice(-(MAX_LATENCY_PROGRESS_ROWS - 1)),
              event.payload,
            ]);
          },
        );
        if (cancelled) {
          offLatency();
          return;
        }
        unlisteners.push(offLatency);

        const offProgress = await listen<TestProgress>(
          "test-progress",
          (event) => {
            appendLog(`[${event.payload.test}] ${event.payload.message}`);
            setLastTestProgress(event.payload);
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
          },
        );
        if (cancelled) {
          offProgress();
          return;
        }
        unlisteners.push(offProgress);

        const offInput = await listen<InputLevelEvent>(
          "input-level",
          (event) => {
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
          },
        );
        if (cancelled) {
          offInput();
          return;
        }
        unlisteners.push(offInput);
      } catch (err) {
        setError(String(err));
      }
    }

    attachListeners();

    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
    // Intentional mount-once Tauri listener attach; callbacks use stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setError,
    latencyRequest,
    setLatencyRequest,
    latencyProgress,
    lastTestProgress,
    latencyReport,
    latencyCalibration,
    calibrationText,
    sweepRequest,
    setSweepRequest,
    sweepLastResult,
    sweepLastResultStatus,
    sweepReviewState,
    sweepRunProgress,
    sweepSessionActive,
    acceptSweepReview,
    rejectSweepReview,
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
    ancRequest,
    setAncRequest,
    ancSelectedModes,
    setAncSelectedModes,
    ancCaptures,
    setAncCaptures,
    ancRunQueue,
    ancCurrentStep,
    ancTotalSteps,
    ancStepPrompt,
    logs,
    results,
    logText,
    library,
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
    startAncFlow,
    confirmAncStep,
    cancelAncFlow,
    resetAncCaptures,
    browseAncOutputFolder,
    exportAncPlots,
    exportAncSquiglink,
    exportLatencyReport,
    exportTextFile,
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
  };
}

export type PawdioLabController = ReturnType<typeof usePawdioLabController>;

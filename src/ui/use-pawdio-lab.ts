import { useEffect, useMemo, useRef, useState } from "react";
import * as ipc from "../ipc/commands";
import { useDebouncedPersist } from "./hooks/use-debounced-persist";
import { useMonitorAndNoise } from "./hooks/use-monitor-and-noise";
import { useResultsLog } from "./hooks/use-results-log";
import { useDevicesController } from "./hooks/use-devices-controller";
import { useLibrary } from "./hooks/use-library";
import { useToast } from "./components/toast";
import { exportTimestampTag } from "./lib/export-files";
import { saveTextFile } from "./lib/save-text";
import { ancAttenuation } from "./lib/anc";
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
  uiKey: "chirp200" | "chirp5k" | "chirp10k";
  storageKey: string;
  label: string;
  signal: LatencyRequest["signal"];
  frequencyHz: number;
};

export type LatencyActivePreset = {
  label: string;
  /** Position in the current suite, from 0. */
  index: number;
  count: number;
  /** Calibration offset the finished report will subtract. */
  offsetMs: number;
  calibrating: boolean;
};

type LatencyExportEntry = {
  request: LatencyRequest;
  report: LatencyReport;
};

type LatencyRunResult = {
  report: LatencyReport;
  calibratedOffsetMs: number;
};

const CALIBRATION_STORAGE_KEY = "pawdio-lab-latency-calibration-v1";
const UI_STATE_STORAGE_KEY = "pawdio-lab-ui-state-v1";
// Long runs emit one latency-progress event per repeat; cap retained rows so
// the array cannot grow without bound across many runs.
const MAX_LATENCY_PROGRESS_ROWS = 1000;

/**
 * A Stop request surfaces from the backend as a "measurement cancelled" error.
 * It is the user's own action, so it is logged rather than shown as a failure.
 */
function isCancellation(err: unknown): boolean {
  return String(err).includes("measurement cancelled");
}

/** Thrown inside a guided sweep session when the user presses Stop. */
class SweepSessionStopped extends Error {
  constructor() {
    super("measurement cancelled");
  }
}

function readStoredCalibration(): LatencyCalibration {
  try {
    const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return defaultLatencyCalibration;
    const parsed = JSON.parse(raw) as Partial<LatencyCalibration> | null;
    const offsets = parsed?.perSoundOffsetsMs;
    if (!offsets || typeof offsets !== "object") {
      return defaultLatencyCalibration;
    }
    const perSoundOffsetsMs: Record<string, number> = {};
    for (const [key, value] of Object.entries(offsets)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        perSoundOffsetsMs[key] = value;
      }
    }
    return { perSoundOffsetsMs };
  } catch {
    return defaultLatencyCalibration;
  }
}

const logCaughtError =
  (label: string) =>
  (err: unknown): undefined => {
    console.warn(`[pawdio-lab] ${label}:`, err);
    return undefined;
  };

// Each preset is a one-octave log chirp centred on its frequency. A swept
// excitation has one unambiguous correlation peak, which the old steady beeps
// did not.
const LATENCY_PRESETS: LatencyPresetConfig[] = [
  {
    uiKey: "chirp200",
    storageKey: "chirp_200",
    label: "200 Hz Chirp",
    signal: "chirp",
    frequencyHz: 200,
  },
  {
    uiKey: "chirp5k",
    storageKey: "chirp_5k",
    label: "5 kHz Chirp",
    signal: "chirp",
    frequencyHz: 5000,
  },
  {
    uiKey: "chirp10k",
    storageKey: "chirp_10k",
    label: "10 kHz Chirp",
    signal: "chirp",
    frequencyHz: 10000,
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

const INPUT_BIT_DEPTHS: ReadonlySet<string> = new Set([
  "auto",
  "16",
  "24",
  "32",
]);

/**
 * Initial audio settings. The bit depth used to live, unused, in the device
 * UI prefs as "Auto"/"16"/"24"/"32"; carry that choice over once.
 */
export function initialAudioSettings(stored: unknown): AudioSettings {
  const merged = mergeWithDefaults(defaultSettings, stored);
  // Look at what was saved, not the merge: the default fills the gap first.
  const saved = toRecord(stored)?.inputBitDepth;
  if (saved !== undefined) {
    return {
      ...merged,
      inputBitDepth: INPUT_BIT_DEPTHS.has(String(saved))
        ? (saved as AudioSettings["inputBitDepth"])
        : "auto",
    };
  }
  let legacy: unknown;
  try {
    legacy = JSON.parse(
      window.localStorage.getItem("pawdio-lab-device-ui-v1") ?? "{}",
    )?.inputBitDepth;
  } catch {
    legacy = undefined;
  }
  const normalized = String(legacy ?? "auto").toLowerCase();
  return {
    ...merged,
    inputBitDepth: INPUT_BIT_DEPTHS.has(normalized)
      ? (normalized as AudioSettings["inputBitDepth"])
      : "auto",
  };
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

/** Must match `latency_preset_identity` in src-tauri/src/audio/mod.rs. */
function calibrationKeyForRequest(request: LatencyRequest): string {
  const frequency = request.frequencyHz;
  if (Math.abs(frequency - 200) <= 5) {
    return "chirp_200";
  }
  if (Math.abs(frequency - 5000) <= 50) {
    return "chirp_5k";
  }
  if (Math.abs(frequency - 10000) <= 100) {
    return "chirp_10k";
  }
  return `chirp_${Math.round(frequency)}`;
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
      initialSettings: initialAudioSettings(persistedUiState?.settings),
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

  const [latencyRequest, setLatencyRequest] = useState<LatencyRequest>(() => ({
    ...mergeWithDefaults(
      defaultLatencyRequest,
      persistedUiState?.latencyRequest,
    ),
    // State saved before the chirp presets can still carry "sine"/"impulse",
    // which the backend no longer accepts.
    signal: "chirp",
  }));
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
  // The preset being measured right now, so the page can name it and scale
  // the backend's raw progress delays by the same offset as the report.
  const [latencyActivePreset, setLatencyActivePreset] =
    useState<LatencyActivePreset | null>(null);
  // Loaded synchronously: reading it in an effect let the persist hook's
  // cleanup (run first under StrictMode) overwrite the stored offsets with the
  // empty default before they were read.
  const [latencyCalibration, setLatencyCalibration] =
    useState<LatencyCalibration>(readStoredCalibration);

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
  // Set by Stop while a guided sweep session runs; checked between captures.
  const sweepAbortRef = useRef(false);
  // True while a multi-step run (preset suite, calibration, ANC step) is in
  // progress. The backend reports idle between its steps, and the 1 s status
  // poll would otherwise flip the UI to idle mid-run.
  const frontendBusyRef = useRef(false);
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
    if (latest.total <= 0) return 0;
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
    const busy = sweepSessionActiveRef.current || frontendBusyRef.current;
    try {
      const status = await ipc.getRuntimeStatus();
      setRunning(status.running || busy);
    } catch {
      setRunning(busy);
    }
  }

  /**
   * Stop the monitor and pink noise before a measurement. The backend stops
   * them too when a run claims the slot; this keeps the UI in step.
   */
  async function prepareForTest() {
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
    setInputMonitor((prev) =>
      prev.monitoring
        ? { ...prev, monitoring: false, status: "Monitoring stopped." }
        : prev,
    );
  }

  /** Report a failed run, or just log it when the user stopped it. */
  function reportRunError(tag: string, err: unknown) {
    if (isCancellation(err)) {
      appendLog(`[${tag}] stopped`);
      return;
    }
    setError(String(err));
    appendLog(`[error] ${String(err)}`);
  }

  // loadState and commitSettings come from useDevicesController (top of hook).

  async function runPayloadTest(
    tag: string,
    run: () => Promise<TestPayload>,
    startLog: string,
  ) {
    if (running) {
      return;
    }
    await prepareForTest();
    setRunning(true);
    setError(null);
    appendLog(startLog);

    try {
      const payload = await run();
      appendResult({
        ...payload,
        timestamp: legacyTimestamp(payload.timestamp),
      });
    } catch (err) {
      reportRunError(tag, err);
    } finally {
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }
  }

  async function runLatencyOnce(
    request: LatencyRequest,
  ): Promise<LatencyRunResult> {
    const calibratedOffsetMs = calibrationOffsetForRequest(
      request,
      latencyCalibration,
    );
    // The backend returns raw delays; it only needs the offset to label the
    // plot and bar chart it saves with the calibrated figures.
    const rawReport = await ipc.runLatencyTest({
      ...request,
      calibratedOffsetMs,
    });
    const calibratedReport = applyLatencyCalibration(
      rawReport,
      request,
      latencyCalibration,
    );
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
    return { report: calibratedReport, calibratedOffsetMs };
  }

  async function runLatencyPresetSuite(presets: LatencyPresetConfig[]) {
    if (running) {
      return;
    }
    if (presets.length === 0) {
      setError("Select at least one latency preset.");
      return;
    }

    await prepareForTest();
    frontendBusyRef.current = true;
    setRunning(true);
    setError(null);
    setLatencyProgress([]);
    setLatencyReport(null);
    setLatencyExportSuite([]);
    appendLog(`[latency] preset suite started (${presets.length})`);

    // One run tag for every preset and for the exports that follow, so the
    // plots, bar chart and text report all land in the same folder.
    const sharedRunTag = exportTimestampTag();
    appendLog(`[latency] run tag -> ${sharedRunTag}`);

    const suiteEntries: LatencyExportEntry[] = [];
    try {
      for (const [index, preset] of presets.entries()) {
        const request: LatencyRequest = {
          ...requestForPreset(latencyRequest, preset),
          saveOverallBarChart: false,
          sharedOutputDir: undefined,
          sharedRunTag,
        };
        setLatencyActivePreset({
          label: preset.label,
          index,
          count: presets.length,
          offsetMs: calibrationOffsetForRequest(request, latencyCalibration),
          calibrating: false,
        });
        // Progress rows are per preset; a stale row from the last one would
        // be read against this preset's offset.
        setLatencyProgress([]);
        appendLog(`[latency] ${preset.label} started`);
        const { report, calibratedOffsetMs } = await runLatencyOnce(request);
        setLatencyReport(report);
        suiteEntries.push({
          request: {
            ...request,
            saveOverallBarChart: latencyRequest.saveOverallBarChart,
            calibratedOffsetMs,
          },
          report,
        });
        // Publish each finished preset so the page can plot it mid-suite.
        setLatencyExportSuite([...suiteEntries]);
        if (report.cancelled) {
          appendLog("[latency] preset suite stopped");
          break;
        }
      }
      if (latencyRequest.saveOverallBarChart && suiteEntries.length > 0) {
        try {
          const barPath = await ipc.saveLatencyOverallBarChart(
            { ...latencyRequest, calibratedOffsetMs: 0, sharedRunTag },
            suiteEntries,
          );
          appendLog(`[latency] overall bar chart saved -> ${barPath}`);
        } catch (barError) {
          appendLog(`[latency] overall bar chart failed: ${String(barError)}`);
        }
      }
      appendLog("[latency] preset suite completed");
    } catch (err) {
      reportRunError("latency", err);
    } finally {
      // Keep whatever finished, so a failure on the last preset still leaves
      // the earlier ones exportable.
      setLatencyExportSuite(suiteEntries);
      setLatencyActivePreset(null);
      frontendBusyRef.current = false;
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
    const selected = LATENCY_PRESETS.filter((preset) =>
      selectedUiKeys.includes(preset.uiKey),
    );
    if (selected.length === 0) {
      setError("Select at least one preset to calibrate.");
      return;
    }
    await prepareForTest();
    frontendBusyRef.current = true;
    setRunning(true);
    setError(null);
    appendLog(`[calibration] selected presets x${repeats}`);

    const updates: Record<string, number> = {};
    let stopped = false;
    try {
      for (const [index, preset] of selected.entries()) {
        setLatencyActivePreset({
          label: preset.label,
          index,
          count: selected.length,
          offsetMs: 0,
          calibrating: true,
        });
        setLatencyProgress([]);
        const request = {
          ...requestForPreset(latencyRequest, preset, repeats),
          savePerSoundPlot: false,
          saveOverallBarChart: false,
          calibratedOffsetMs: 0,
          sharedOutputDir: undefined,
          sharedRunTag: undefined,
        };
        appendLog(`[calibration] ${preset.label} measuring...`);
        const report = await ipc.runLatencyTest(request);
        if (report.cancelled) {
          // A partial average is not a baseline; keep the old offset.
          appendLog(`[calibration] ${preset.label} stopped; offset unchanged`);
          stopped = true;
          break;
        }
        if (report.averageDelayMs !== null) {
          updates[preset.storageKey] = report.averageDelayMs;
          appendLog(
            `[calibration] ${preset.label} baseline = ${report.averageDelayMs.toFixed(2)} ms`,
          );
        } else {
          appendLog(`[calibration] ${preset.label} failed`);
        }
      }
    } catch (err) {
      stopped = isCancellation(err);
      reportRunError("calibration", err);
    } finally {
      setLatencyActivePreset(null);
      const calibrated = Object.keys(updates).length;
      if (calibrated > 0) {
        setLatencyCalibration((prev) => ({
          ...prev,
          perSoundOffsetsMs: { ...prev.perSoundOffsetsMs, ...updates },
        }));
      }
      if (calibrated === selected.length) {
        appendLog("[calibration] selected presets complete");
        toast("Calibration complete", { kind: "success" });
      } else if (calibrated > 0) {
        toast(
          `Calibrated ${calibrated} of ${selected.length} presets${stopped ? " before stopping" : ""}`,
          { kind: "info" },
        );
      } else if (!stopped) {
        setError("Calibration failed: no preset produced a delay.");
      }
      frontendBusyRef.current = false;
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

  /**
   * Write the plots and Squiglink files for the accepted sweeps. Each capture
   * runs with exports off, so a discarded sweep never leaves files behind and
   * every file describes exactly the curves that were kept.
   */
  async function writeAcceptedSweepOutputs(
    result: TestPayload,
    runTag: string,
  ): Promise<TestPayload> {
    if (!sweepRequest.savePlots && !sweepRequest.saveSquiglink) {
      return { ...result, files: {} };
    }
    const data = recordOrEmpty(result.data);
    const freqs = numberList(data.freqs);
    if (freqs.length === 0) return result;
    try {
      const files = await ipc.saveSweepOutputs({
        outputDir: sweepRequest.outputDir.trim() || null,
        runTag,
        savePlots: sweepRequest.savePlots,
        saveSquiglink: sweepRequest.saveSquiglink,
        freqs,
        leftCurves: numberCurveList(data.left_mag_db_all),
        rightCurves: numberCurveList(data.right_mag_db_all),
      });
      return { ...result, files };
    } catch (err) {
      setError(
        `Sweeps kept, but saving the export files failed: ${String(err)}`,
      );
      appendLog(`[SWEEP FR] export failed: ${String(err)}`);
      return { ...result, files: {} };
    }
  }

  async function runSweepFrTest() {
    if (running || sweepSessionActiveRef.current) {
      return;
    }
    sweepSessionActiveRef.current = true;
    sweepAbortRef.current = false;
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
        if (sweepAbortRef.current) throw new SweepSessionStopped();
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
          // Exports are written once from the accepted sweeps, below.
          savePlots: false,
          saveSquiglink: false,
        });
        if (sweepAbortRef.current) throw new SweepSessionStopped();
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
        if (sweepAbortRef.current) throw new SweepSessionStopped();
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
    await prepareForTest();
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
      acceptedResult = await writeAcceptedSweepOutputs(
        acceptedResult,
        sharedRunTag,
      );
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
      if (isCancellation(err)) {
        setSweepRunProgress(null);
        appendLog("[SWEEP FR] session stopped; no result recorded");
      } else {
        reportRunError("SWEEP FR", err);
      }
    } finally {
      setSweepReviewState(null);
      setMonoConfirmState(null);
      sweepAbortRef.current = false;
      sweepSessionActiveRef.current = false;
      setSweepSessionActive(false);
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }
  }

  // startInputMonitor / stopInputMonitor / startPinkNoise / stopPinkNoise /
  // resetInputMonitorPeak come from useMonitorAndNoise (top of hook).

  async function runBalanceTest() {
    await runPayloadTest(
      "BALANCE",
      () => ipc.runBalanceTest(balanceRequest),
      "[BALANCE] running",
    );
  }

  async function runCrosstalkTest() {
    await runPayloadTest(
      "CROSSTALK",
      () => ipc.runCrosstalkTest(crosstalkRequest),
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
    await runPayloadTest("THD", () => ipc.runThdTest(next), "[THD] running");
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

  /**
   * Save an export into `outputDir`, or ask where to save when none is set.
   * Resolves to the written path, or null when the user cancelled.
   */
  async function exportTextFile(
    outputDir: string,
    filename: string,
    content: string,
    mimeType: string,
  ): Promise<string | null> {
    const path = await saveTextFile({ outputDir, filename, content, mimeType });
    if (path) toast(`Exported ${path}`, { kind: "success" });
    return path;
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
      if (path) appendLog(`[sweep_fr] exported LAST JSON -> ${path}`);
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
      if (path)
        appendLog(
          `[sweep_fr] exported ALL JSON (${sweepResults.length}) -> ${path}`,
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
      const path = await exportTextFile(
        sweepRequest.outputDir,
        filename,
        `${lines.join("\n")}\n`,
        "text/plain;charset=utf-8",
      );
      if (path) appendLog(`[sweep_fr] exported LAST Squiglink -> ${path}`);
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

      // One column per curve. A side that was not captured simply has no
      // column; rows run the full grid so a missing side cannot empty the file.
      const columns: Array<{ header: string; values: number[] }> = [];
      if (leftAvg.length > 0) {
        columns.push({ header: "Left_Avg(dB)", values: leftAvg });
      }
      if (rightAvg.length > 0) {
        columns.push({ header: "Right_Avg(dB)", values: rightAvg });
      }
      leftAll.forEach((values, i) =>
        columns.push({ header: `Left_Sweep_${i + 1}(dB)`, values }),
      );
      rightAll.forEach((values, i) =>
        columns.push({ header: `Right_Sweep_${i + 1}(dB)`, values }),
      );

      const lines = [
        ["Frequency(Hz)", ...columns.map((column) => column.header)].join(","),
      ];
      for (let i = 0; i < freqs.length; i++) {
        lines.push(
          [
            freqs[i].toFixed(2),
            ...columns.map((column) =>
              i < column.values.length ? column.values[i].toFixed(3) : "",
            ),
          ].join(","),
        );
      }

      const path = await exportTextFile(
        sweepRequest.outputDir,
        filename,
        `${lines.join("\n")}\n`,
        "text/csv;charset=utf-8",
      );
      if (path) appendLog(`[sweep_fr] exported LAST CSV -> ${path}`);
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
        // Average and std dev sit in their own columns on each preset's first
        // row (they used to be appended after two empty cells, shifting them
        // out from under their headers).
        const average = entry.report.averageDelayMs?.toFixed(3) ?? "";
        const std = entry.report.stdDevMs?.toFixed(3) ?? "";

        entry.report.measurements.forEach((measurement, index) => {
          const delay =
            measurement.delayMs !== null ? measurement.delayMs.toFixed(3) : "";
          const summary = index === 0 ? `${average},${std}` : ",";
          lines.push(
            `${signal},${freq},${measurement.iteration},${delay},${summary}`,
          );
        });
      }

      const path = await exportTextFile(
        latencyRequest.outputDir,
        filename,
        `${lines.join("\n")}\n`,
        "text/csv;charset=utf-8",
      );
      if (path) appendLog(`[latency] exported CSV -> ${path}`);
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  async function browseLatencyOutputFolder() {
    setError(null);
    try {
      const selected = await ipc.pickDirectory(latencyRequest.outputDir);
      if (selected) {
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
      const selected = await ipc.pickDirectory(sweepRequest.outputDir);
      if (selected) {
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
    if (!ancCurrentStep || running) return;
    const { mode, side } = ancCurrentStep;
    const remaining = ancRunQueue;
    const isLastStep = remaining.length === 0;
    await prepareForTest();
    // Keep the step modal open and flag the run so its in-progress state shows
    // immediately. The prompt advances once the capture resolves (below).
    frontendBusyRef.current = true;
    setRunning(true);
    setError(null);
    // Only a capture that actually landed may advance the guided flow. A failed
    // or stopped step stays on the same mode so the user can retry or cancel;
    // advancing regardless would auto-export a run with a mode missing.
    let captured = false;
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
      captured = true;
      appendLog(`[anc] captured ${mode} (${side}) @ ${result.timestamp}`);

      // Auto-export once the last mode is captured. No output dir needed: the
      // backend falls back to the default export folder. The captures are
      // already kept, so a failed write never strands the flow.
      if (isLastStep && ancRequest.savePlots) {
        const baselineKey = ANC_MODE_ORDERED.find(
          (m) => newCaptures[m] !== undefined,
        );
        const baseline = baselineKey ? newCaptures[baselineKey] : undefined;
        const exportable = ANC_MODE_ORDERED.filter(
          (m) => m !== baselineKey && newCaptures[m] !== undefined,
        );
        if (baseline && exportable.length > 0) {
          // One tag for the whole run so plots and TXT share one folder.
          const runTag = exportTimestampTag();
          let exported = await exportAncPlots(
            baseline,
            exportable.map((key) => ({
              key,
              label: ANC_MODE_META[key].label,
              snapshot: newCaptures[key]!,
            })),
            runTag,
          );
          for (const key of exportable) {
            const ok = await exportAncSquiglink(
              baseline,
              key,
              ANC_MODE_META[key].label,
              newCaptures[key]!,
              runTag,
            );
            exported = exported && ok;
          }
          if (!exported) {
            appendLog("[anc] captures kept; some exports failed");
          }
        }
      }
    } catch (err) {
      if (isCancellation(err)) {
        appendLog(`[anc] ${mode} (${side}) stopped; step kept for retry`);
      } else {
        setError(String(err));
        appendLog(`[anc] capture failed on ${mode} (${side}): ${String(err)}`);
      }
    } finally {
      frontendBusyRef.current = false;
      refreshRuntimeStatus().catch(logCaughtError("refreshRuntimeStatus"));
    }

    if (!captured) return;

    const next = remaining[0] ?? null;
    setAncCurrentStep(next);
    setAncStepPrompt(next !== null);
    setAncRunQueue(remaining.slice(1));
    if (next === null) setAncTotalSteps(0);
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
      const selected = await ipc.pickDirectory(ancRequest.outputDir);
      if (selected) {
        setAncRequest((prev) => ({ ...prev, outputDir: selected }));
        appendLog(`[anc] output folder set -> ${selected}`);
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    }
  }

  /** Save the attenuation PNGs. Resolves true when they were written. */
  async function exportAncPlots(
    baseline: AncSnapshot,
    modesToExport: Array<{
      key: AncModeKey;
      label: string;
      snapshot: AncSnapshot;
    }>,
    // Manual exports from the ANC page pass no tag and get their own folder;
    // the guided run passes one tag so plots and TXT land together.
    timestamp: string = exportTimestampTag(),
  ): Promise<boolean> {
    try {
      // negative = cancelled (active quieter than baseline)
      const modes = modesToExport.map(({ key, label, snapshot }) => ({
        key,
        label,
        attenuationLeft: ancAttenuation(snapshot, baseline, "L"),
        attenuationRight: ancAttenuation(snapshot, baseline, "R"),
      }));
      const saved = await ipc.saveAncPlots({
        outputDir: ancRequest.outputDir || null,
        timestamp,
        freqs: baseline.freqs,
        modes,
      });
      const savedPath = saved[0]?.[1];
      if (!savedPath) {
        appendLog("[anc] no attenuation data to plot");
        return false;
      }
      const folder = savedPath.slice(
        0,
        Math.max(savedPath.lastIndexOf("/"), savedPath.lastIndexOf("\\")),
      );
      appendLog(`[anc] plots saved to ${folder}`);
      toast(`ANC plots saved to ${folder}`, { kind: "success" });
      return true;
    } catch (err) {
      setError(String(err));
      appendLog(`[anc] export error: ${String(err)}`);
      return false;
    }
  }

  /** Save one mode's attenuation as Squiglink TXT. Resolves true on success. */
  async function exportAncSquiglink(
    baseline: AncSnapshot,
    modeKey: AncModeKey,
    modeLabel: string,
    snapshot: AncSnapshot,
    timestamp: string = exportTimestampTag(),
  ): Promise<boolean> {
    try {
      // Squiglink is single-channel: prefer the left curve, but fall back to
      // the right when a guided right-only capture left the left side empty.
      const left = ancAttenuation(snapshot, baseline, "L");
      const attenuationDb =
        left.length > 0 ? left : ancAttenuation(snapshot, baseline, "R");
      if (attenuationDb.length === 0) {
        appendLog(`[anc] ${modeKey}: no attenuation data to export`);
        return false;
      }
      const outputPath = await ipc.saveAncSquiglink({
        outputDir: ancRequest.outputDir || null,
        timestamp,
        modeKey,
        modeLabel,
        freqs: baseline.freqs,
        attenuationDb,
      });
      appendLog(`[anc] squiglink saved: ${outputPath}`);
      toast(`Saved anc_${modeKey}_${timestamp}.txt`, { kind: "success" });
      return true;
    } catch (err) {
      setError(String(err));
      appendLog(`[anc] squiglink error: ${String(err)}`);
      return false;
    }
  }

  async function stopTest() {
    // A guided sweep session spans several captures and dialogs; end all of
    // it, not just the capture in flight.
    if (sweepSessionActiveRef.current) {
      sweepAbortRef.current = true;
      sweepReviewState?.resolve(false);
      setSweepReviewState(null);
      monoConfirmState?.reject(new Error("measurement cancelled"));
      setMonoConfirmState(null);
    }
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
        const offLatency = await ipc.onLatencyProgress((progress) => {
          setLatencyProgress((prev) => [
            ...prev.slice(-(MAX_LATENCY_PROGRESS_ROWS - 1)),
            progress,
          ]);
        });
        if (cancelled) {
          offLatency();
          return;
        }
        unlisteners.push(offLatency);

        const offProgress = await ipc.onTestProgress((payload) => {
          appendLog(`[${payload.test}] ${payload.message}`);
          setLastTestProgress(payload);
          if (
            payload.test === "monitor" &&
            payload.message.toLowerCase().includes("error")
          ) {
            setInputMonitor((prev) => ({
              ...prev,
              monitoring: false,
              status: "Monitor error. Check input device/sample rate.",
            }));
          }
          if (
            payload.test === "pink_noise" &&
            payload.message.toLowerCase().includes("error")
          ) {
            setPinkNoisePlaying(false);
            setInputMonitor((prev) => ({
              ...prev,
              status: "Pink noise error. Check output device/sample rate.",
            }));
          }
        });
        if (cancelled) {
          offProgress();
          return;
        }
        unlisteners.push(offProgress);

        const offInput = await ipc.onInputLevel((level) => {
          const current = level.currentDbfs;
          const peakFromBackend = level.peakDbfs;
          const clips = level.clipCount;
          setInputMonitor((prev) => {
            const peak = Math.max(prev.peakDbfs, current, peakFromBackend);
            return {
              ...prev,
              monitoring: true,
              status: "Monitoring input...",
              currentDbfs: current,
              peakDbfs: peak,
              clipCount: clips,
              roughFrHz:
                Array.isArray(level.roughFrHz) && level.roughFrHz.length > 0
                  ? level.roughFrHz
                  : prev.roughFrHz,
              roughFrDb:
                Array.isArray(level.roughFrDb) && level.roughFrDb.length > 0
                  ? level.roughFrDb
                  : prev.roughFrDb,
            };
          });
        });
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
    latencySuite: latencyExportSuite,
    latencyActivePreset,
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
    runLatencySelectedTests,
    runLatencyAllTests,
    calibrateLatencySelected,
    calibrateLatencyAllPresets,
    runSweepFrTest,
    runBalanceTest,
    runCrosstalkTest,
    runThdTest,
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

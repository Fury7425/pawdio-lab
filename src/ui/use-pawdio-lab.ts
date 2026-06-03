import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import * as ipc from "../ipc/commands";
import { useDebouncedPersist } from "./hooks/use-debounced-persist";
import { useMonitorAndNoise } from "./hooks/use-monitor-and-noise";
import { useResultsLog } from "./hooks/use-results-log";
import { useDevicesController } from "./hooks/use-devices-controller";
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const [latencyRequest, setLatencyRequest] = useState<LatencyRequest>(
    mergeWithDefaults(defaultLatencyRequest, persistedUiState?.latencyRequest),
  );
  const [latencyProgress, setLatencyProgress] = useState<LatencyProgress[]>([]);
  const [lastTestProgress, setLastTestProgress] = useState<TestProgress | null>(null);
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
      setRunning(status.running);
    } catch {
      setRunning(false);
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

  async function runSweepFrTest() {
    if (running) {
      return;
    }
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

    if (guided) {
      try {
        await requestMonoConfirm(
          `Mono mode: place the ${sideWord(firstSide)} earphone/driver on the measurement position, then click OK to run the ${sideWord(firstSide)} sweep.`,
        );
      } catch {
        appendLog(
          `[SWEEP FR] mono run cancelled before ${sideWord(firstSide)} sweep`,
        );
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
      if (!guided) {
        const payload = await invokeSweepFrRaw({
          ...sweepRequest,
          monoMode: false,
        });
        const normalized = {
          ...payload,
          timestamp: legacyTimestamp(payload.timestamp),
        };
        setSweepLastResult(normalized);
        appendResult(normalized);
      } else {
        const sharedRunTag = exportTimestampTag();
        const sidePayloads: Partial<Record<"left" | "right", TestPayload>> = {};

        appendLog(`[SWEEP FR] running ${sideWord(firstSide)} sweep`);
        sidePayloads[firstSide] = await invokeSweepFrRaw({
          ...sweepRequest,
          monoMode: true,
          monoSide: firstSide,
          sharedRunTag,
        });
        appendLog(`[SWEEP FR] ${sideWord(firstSide)} sweep complete`);

        setRunning(false);
        try {
          await requestMonoConfirm(
            `Now place the ${sideWord(secondSide)} earphone/driver on the measurement position, then click OK to run the ${sideWord(secondSide)} sweep.`,
          );
        } catch {
          const firstOnly = {
            ...sidePayloads[firstSide]!,
            timestamp: legacyTimestamp(sidePayloads[firstSide]!.timestamp),
          };
          setSweepLastResult(firstOnly);
          appendResult(firstOnly);
          appendLog(
            `[SWEEP FR] mono run stopped after ${sideWord(firstSide)} sweep`,
          );
          return;
        }
        setRunning(true);

        appendLog(`[SWEEP FR] running ${sideWord(secondSide)} sweep`);
        sidePayloads[secondSide] = await invokeSweepFrRaw({
          ...sweepRequest,
          monoMode: true,
          monoSide: secondSide,
          sharedRunTag,
        });
        const leftPayload = sidePayloads.left!;
        const rightPayload = sidePayloads.right!;
        const combinedPayload = combineGuidedMonoSweepPayload(
          leftPayload,
          rightPayload,
        );

        // Write squiglink_both by combining left+right avg data.
        // Derive the path from the left sweep's squiglink_left file.
        let squiglinkBothPath: string | undefined;
        const leftSquiglinkPath = String(
          leftPayload.files?.squiglink_left ?? "",
        );
        if (leftSquiglinkPath) {
          const bothPath = leftSquiglinkPath.replace(
            "squiglink_left_",
            "squiglink_both_",
          );
          const freqs = numberList(leftPayload.data["freqs"]);
          const leftDb = numberList(leftPayload.data["left_mag_db_avg"]);
          const rightDb = numberList(rightPayload.data["right_mag_db_avg"]);
          if (freqs.length && leftDb.length && rightDb.length) {
            await ipc
              .writeSquiglinkCombined({
                outputPath: bothPath,
                freqs,
                leftDb,
                rightDb,
              })
              .catch(logCaughtError("writeSquiglinkCombined"));
            squiglinkBothPath = bothPath;
          }
        }

        const normalized = {
          ...combinedPayload,
          timestamp: legacyTimestamp(combinedPayload.timestamp),
          ...(squiglinkBothPath && {
            files: {
              ...combinedPayload.files,
              squiglink_both: squiglinkBothPath,
            },
          }),
        };
        setSweepLastResult(normalized);
        appendResult(normalized);
        appendLog("[SWEEP FR] mono guided run completed");
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
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
        const baselineKey = ANC_MODE_ORDERED.find((m) => newCaptures[m] !== undefined);
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
    modesToExport: Array<{ key: AncModeKey; label: string; snapshot: AncSnapshot }>,
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
            setLatencyProgress((prev) => [...prev, event.payload]);
          },
        );
        if (cancelled) { offLatency(); return; }
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
        if (cancelled) { offProgress(); return; }
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
        if (cancelled) { offInput(); return; }
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

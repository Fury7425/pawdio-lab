import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
  parseToneList
} from "./model";

type LatencyPresetConfig = {
  uiKey: "beep1k" | "beep2k" | "beep5k" | "beep200" | "impulse";
  storageKey: string;
  label: string;
  signal: LatencyRequest["signal"];
  frequencyHz: number;
};

type InputLevelEvent = {
  currentDbfs: number;
  peakDbfs: number;
  clipCount: number;
};

type InputMonitorState = {
  monitoring: boolean;
  status: string;
  currentDbfs: number;
  peakDbfs: number;
  clipCount: number;
  splEstimate: number;
};

const CALIBRATION_STORAGE_KEY = "pawdio-lab-latency-calibration-v1";
const UI_STATE_STORAGE_KEY = "pawdio-lab-ui-state-v1";

const LATENCY_PRESETS: LatencyPresetConfig[] = [
  {
    uiKey: "beep1k",
    storageKey: "beep_1k",
    label: "1 kHz Beep",
    signal: "sine",
    frequencyHz: 1000
  },
  {
    uiKey: "beep2k",
    storageKey: "beep_2k",
    label: "2 kHz Beep",
    signal: "sine",
    frequencyHz: 2000
  },
  {
    uiKey: "beep5k",
    storageKey: "beep_5k",
    label: "5 kHz Beep",
    signal: "sine",
    frequencyHz: 5000
  },
  {
    uiKey: "beep200",
    storageKey: "beep_200",
    label: "200 Hz Beep",
    signal: "sine",
    frequencyHz: 200
  },
  {
    uiKey: "impulse",
    storageKey: "impulse",
    label: "Click (Impulse)",
    signal: "impulse",
    frequencyHz: 1000
  }
];

const DEFAULT_INPUT_MONITOR: InputMonitorState = {
  monitoring: false,
  status: "Ready to measure...",
  currentDbfs: -96,
  peakDbfs: -96,
  clipCount: 0,
  splEstimate: -2
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

function mergeWithDefaults<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
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

function applyLatencyCalibration(
  report: LatencyReport,
  request: LatencyRequest,
  calibration: LatencyCalibration
): LatencyReport {
  const key = calibrationKeyForRequest(request);
  const perSound = calibration.perSoundOffsetsMs[key] ?? 0;
  const offset = perSound + calibration.globalOffsetMs;
  if (offset === 0) {
    return report;
  }

  const adjustedMeasurements = report.measurements.map((measurement) => ({
    ...measurement,
    delayMs: measurement.delayMs === null ? null : measurement.delayMs - offset
  }));
  const values = adjustedMeasurements
    .map((measurement) => measurement.delayMs)
    .filter((value): value is number => value !== null);
  const average = values.length > 0 ? mean(values) : null;
  const std = values.length > 0 && average !== null ? stdDev(values, average) : null;

  return {
    ...report,
    measurements: adjustedMeasurements,
    averageDelayMs: average,
    stdDevMs: std
  };
}

function requestForPreset(base: LatencyRequest, preset: LatencyPresetConfig, repeats?: number): LatencyRequest {
  return {
    ...base,
    signal: preset.signal,
    frequencyHz: preset.frequencyHz,
    repeats: repeats ?? base.repeats
  };
}

function combineGuidedMonoSweepPayload(leftPayload: TestPayload, rightPayload: TestPayload): TestPayload {
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
      mono_side: "guided_left_then_right"
    },
    metrics: {
      delay_ms_left: leftMetrics.delay_ms_left ?? null,
      delay_ms_right: rightMetrics.delay_ms_right ?? null
    },
    data: {
      freqs: leftData.freqs ?? rightData.freqs ?? [],
      left_mag_db_avg: leftData.left_mag_db_avg ?? [],
      left_mag_db_all: leftAll,
      right_mag_db_avg: rightData.right_mag_db_avg ?? [],
      right_mag_db_all: rightAll,
      mag_db_all: combinedAll,
      mag_db_avg_all: combinedAvg
    },
    files: {
      ...leftFiles,
      ...rightFiles
    }
  };
}

export function usePawdioLabController() {
  const persistedUiState = useMemo(() => readPersistedUiState(), []);

  const [activePage, setActivePage] = useState<PageKey>(
    parsePageKey(persistedUiState?.activePage)
  );
  const [experimentalEnabled, setExperimentalEnabled] = useState(
    typeof persistedUiState?.experimentalEnabled === "boolean"
      ? persistedUiState.experimentalEnabled
      : true
  );
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(
    mergeWithDefaults(defaultSettings, persistedUiState?.settings)
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latencyRequest, setLatencyRequest] = useState<LatencyRequest>(
    mergeWithDefaults(defaultLatencyRequest, persistedUiState?.latencyRequest)
  );
  const [latencyProgress, setLatencyProgress] = useState<LatencyProgress[]>([]);
  const [latencyReport, setLatencyReport] = useState<LatencyReport | null>(null);
  const [latencyCalibration, setLatencyCalibration] =
    useState<LatencyCalibration>(defaultLatencyCalibration);

  const [sweepRequest, setSweepRequest] = useState<SweepRequest>(
    mergeWithDefaults(defaultSweepRequest, persistedUiState?.sweepRequest)
  );
  const [sweepLastResult, setSweepLastResult] = useState<TestPayload | null>(null);
  const [inputMonitor, setInputMonitor] = useState<InputMonitorState>(DEFAULT_INPUT_MONITOR);
  const [pinkNoisePlaying, setPinkNoisePlaying] = useState(false);

  const [balanceRequest, setBalanceRequest] = useState(
    mergeWithDefaults(defaultBalanceRequest, persistedUiState?.balanceRequest)
  );
  const [crosstalkRequest, setCrosstalkRequest] = useState<CrosstalkRequest>(
    mergeWithDefaults(defaultCrosstalkRequest, persistedUiState?.crosstalkRequest)
  );
  const [thdRequest, setThdRequest] = useState<ThdRequest>(
    mergeWithDefaults(defaultThdRequest, persistedUiState?.thdRequest)
  );
  const [thdToneText, setThdToneText] = useState(
    typeof persistedUiState?.thdToneText === "string"
      ? persistedUiState.thdToneText
      : defaultThdRequest.tones.join(", ")
  );
  const [isolationRequest, setIsolationRequest] = useState<IsolationRequest>(
    mergeWithDefaults(defaultIsolationRequest, persistedUiState?.isolationRequest)
  );

  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const nextResultId = useRef(1);

  const latencyProgressPercent = useMemo(() => {
    if (latencyProgress.length === 0) {
      return 0;
    }
    const latest = latencyProgress[latencyProgress.length - 1];
    return Math.floor((latest.current / latest.total) * 100);
  }, [latencyProgress]);

  const logText = useMemo(() => logs.join("\n"), [logs]);

  const resultText = useMemo(() => {
    return results.map((entry) => JSON.stringify(entry.payload, null, 2)).join("\n\n");
  }, [results]);

  const calibrationText = useMemo(() => {
    const ordered = LATENCY_PRESETS.map((preset) => {
      const value = latencyCalibration.perSoundOffsetsMs[preset.storageKey] ?? 0;
      return `- ${preset.label}: ${value.toFixed(2)}`;
    });
    return [
      "Per-sound baselines (ms):",
      ...ordered,
      "",
      `GLOBAL offset: ${latencyCalibration.globalOffsetMs.toFixed(2)} ms`
    ].join("\n");
  }, [latencyCalibration]);

  function appendLog(message: string) {
    const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, `[${stamp}] ${message}`]);
  }

  function appendResult(payload: TestPayload) {
    setResults((prev) => [...prev, { id: nextResultId.current++, payload }]);
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
        invoke<AudioSettings>("get_audio_settings")
      ]);

      setInventory(devices);
      const merged = { ...liveSettings, ...settings };
      const outputIndices = new Set(devices.outputs.map((device) => device.index));
      const inputIndices = new Set(devices.inputs.map((device) => device.index));
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
      if (merged.outputDeviceIndex === null && devices.defaultOutputIndex !== null) {
        merged.outputDeviceIndex = devices.defaultOutputIndex;
      }
      if (merged.inputDeviceIndex === null && devices.defaultInputIndex !== null) {
        merged.inputDeviceIndex = devices.defaultInputIndex;
      }
      const committed = await invoke<AudioSettings>("set_audio_settings", { settings: merged });
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function commitSettings(next: AudioSettings) {
    const normalized = { ...next };
    if (inventory) {
      const outputIndices = new Set(inventory.outputs.map((device) => device.index));
      const inputIndices = new Set(inventory.inputs.map((device) => device.index));
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
        settings: normalized
      });
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function runPayloadTest(command: string, request: unknown, startLog: string) {
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
      status: "Monitoring stopped."
    }));
    setRunning(true);
    setError(null);
    appendLog(startLog);

    try {
      const payload = await invoke<TestPayload>(command, { request });
      appendResult({ ...payload, timestamp: legacyTimestamp(payload.timestamp) });
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function invokeLatencyRaw(request: LatencyRequest): Promise<LatencyReport> {
    return invoke<LatencyReport>("run_latency_test", { request });
  }

  async function runLatencyOnce(request: LatencyRequest, includeResult = true): Promise<LatencyReport> {
    const rawReport = await invokeLatencyRaw(request);
    const calibratedReport = applyLatencyCalibration(rawReport, request, latencyCalibration);
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
          calibrated_offset_ms:
            (latencyCalibration.perSoundOffsetsMs[calibrationKeyForRequest(request)] ?? 0) +
            latencyCalibration.globalOffsetMs
        },
        metrics: {
          average_delay_ms: calibratedReport.averageDelayMs,
          std_dev_ms: calibratedReport.stdDevMs,
          cancelled: calibratedReport.cancelled
        },
        data: {
          sample_rate: calibratedReport.sampleRate,
          input_sample_rate: calibratedReport.inputSampleRate,
          measurements: calibratedReport.measurements
        },
        files: {}
      });
    }
    return calibratedReport;
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
      status: "Monitoring stopped."
    }));
    setRunning(true);
    setError(null);
    setLatencyProgress([]);
    setLatencyReport(null);
    appendLog(`[latency] started (${latencyRequest.signal})`);

    try {
      const report = await runLatencyOnce(latencyRequest, true);
      setLatencyReport(report);
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
      status: "Monitoring stopped."
    }));
    setRunning(true);
    setError(null);
    setLatencyProgress([]);
    setLatencyReport(null);
    appendLog(`[latency] preset suite started (${presets.length})`);

    try {
      for (const preset of presets) {
        const request = requestForPreset(latencyRequest, preset);
        appendLog(`[latency] ${preset.label} started`);
        const report = await runLatencyOnce(request, true);
        setLatencyReport(report);
        if (report.cancelled) {
          appendLog("[latency] preset suite cancelled");
          break;
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
    selectedUiKeys: Array<LatencyPresetConfig["uiKey"]>
  ) {
    const selected = LATENCY_PRESETS.filter((preset) => selectedUiKeys.includes(preset.uiKey));
    await runLatencyPresetSuite(selected);
  }

  async function runLatencyAllTests() {
    await runLatencyPresetSuite(LATENCY_PRESETS);
  }

  async function calibrateLatencySelected(
    selectedUiKeys: Array<LatencyPresetConfig["uiKey"]>,
    repeats: number
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
      status: "Monitoring stopped."
    }));
    setRunning(true);
    setError(null);
    appendLog(`[calibration] selected presets x${repeats}`);

    const updates: Record<string, number> = {};
    try {
      const selected = LATENCY_PRESETS.filter((preset) => selectedUiKeys.includes(preset.uiKey));
      for (const preset of selected) {
        const request = {
          ...requestForPreset(latencyRequest, preset, repeats),
          savePerSoundPlot: false,
          saveOverallBarChart: false
        };
        appendLog(`[calibration] ${preset.label} measuring...`);
        const report = await invokeLatencyRaw(request);
        if (report.averageDelayMs !== null) {
          updates[preset.storageKey] = report.averageDelayMs;
          appendLog(`[calibration] ${preset.label} baseline = ${report.averageDelayMs.toFixed(2)} ms`);
        } else {
          appendLog(`[calibration] ${preset.label} failed`);
        }
      }
      if (Object.keys(updates).length > 0) {
        setLatencyCalibration((prev) => ({
          ...prev,
          perSoundOffsetsMs: { ...prev.perSoundOffsetsMs, ...updates }
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
      repeats
    );
  }

  async function calibrateLatencyGlobalImpulse(repeats: number) {
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
      status: "Monitoring stopped."
    }));
    setRunning(true);
    setError(null);
    appendLog(`[calibration] global impulse x${repeats}`);

    try {
      const impulse = LATENCY_PRESETS.find((preset) => preset.uiKey === "impulse");
      if (!impulse) {
        return;
      }
      const request = {
        ...requestForPreset(latencyRequest, impulse, repeats),
        savePerSoundPlot: false,
        saveOverallBarChart: false
      };
      const report = await invokeLatencyRaw(request);
      const averageDelay = report.averageDelayMs;
      if (averageDelay !== null) {
        setLatencyCalibration((prev) => ({
          ...prev,
          globalOffsetMs: averageDelay
        }));
        appendLog(`[calibration] global offset = ${averageDelay.toFixed(2)} ms`);
      } else {
        appendLog("[calibration] global calibration failed");
      }
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function invokeSweepFrRaw(request: SweepInvokeRequest): Promise<TestPayload> {
    return invoke<TestPayload>("run_sweep_fr_test", { request });
  }

  async function runSweepFrTest() {
    if (running) {
      return;
    }
    const monoGuided = sweepRequest.monoMode;
    if (
      monoGuided &&
      !window.confirm(
        "Mono mode: place the LEFT side on the measurement position, then click OK to run the LEFT sweep."
      )
    ) {
      appendLog("[SWEEP FR] mono run cancelled before LEFT sweep");
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
      status: "Monitoring stopped."
    }));
    setRunning(true);
    setError(null);
    appendLog(
      monoGuided ? "[SWEEP FR] mono guided run started (LEFT -> RIGHT)" : "[SWEEP FR] running"
    );
    try {
      if (!monoGuided) {
        const payload = await invokeSweepFrRaw(sweepRequest);
        const normalized = { ...payload, timestamp: legacyTimestamp(payload.timestamp) };
        setSweepLastResult(normalized);
        appendResult(normalized);
      } else {
        appendLog("[SWEEP FR] running LEFT sweep");
        const leftPayload = await invokeSweepFrRaw({ ...sweepRequest, monoSide: "left" });
        appendLog("[SWEEP FR] LEFT sweep complete");

        const proceedRight = window.confirm(
          "Now place the RIGHT side on the measurement position, then click OK to run the RIGHT sweep."
        );
        if (!proceedRight) {
          const leftOnly = { ...leftPayload, timestamp: legacyTimestamp(leftPayload.timestamp) };
          setSweepLastResult(leftOnly);
          appendResult(leftOnly);
          appendLog("[SWEEP FR] mono run stopped after LEFT sweep");
          return;
        }

        appendLog("[SWEEP FR] running RIGHT sweep");
        const rightPayload = await invokeSweepFrRaw({ ...sweepRequest, monoSide: "right" });
        const combinedPayload = combineGuidedMonoSweepPayload(leftPayload, rightPayload);
        const normalized = {
          ...combinedPayload,
          timestamp: legacyTimestamp(combinedPayload.timestamp)
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
        status: "Monitoring input..."
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
        status: "Monitoring stopped."
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
        status: prev.monitoring ? prev.status : "Playing pink noise..."
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
        status: prev.monitoring ? prev.status : "Pink noise stopped."
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
      clipCount: 0
    }));
  }

  async function runBalanceTest() {
    await runPayloadTest("run_balance_test", balanceRequest, "[BALANCE] running");
  }

  async function runCrosstalkTest() {
    await runPayloadTest("run_crosstalk_test", crosstalkRequest, "[CROSSTALK] running");
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
    await runPayloadTest("run_isolation_test", isolationRequest, "[ISOLATION] running");
  }

  async function exportLatencyReport() {
    if (!latencyReport) {
      setError("No latency report to export yet.");
      return;
    }
    setError(null);
    try {
      const path = await invoke<string>("export_latency_report", {
        request: latencyRequest,
        report: latencyReport
      });
      appendLog(`[latency] report saved -> ${path}`);
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
        status: "Monitoring stopped."
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
          globalOffsetMs: Number.isFinite(parsed.globalOffsetMs) ? parsed.globalOffsetMs : 0
        });
      }
    } catch {
      // ignore invalid persisted calibration state
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(latencyCalibration));
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
      isolationRequest
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
    isolationRequest
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
      if (event.payload.test === "monitor" && event.payload.message.toLowerCase().includes("error")) {
        setInputMonitor((prev) => ({
          ...prev,
          monitoring: false,
          status: "Monitor error. Check input device/sample rate."
        }));
      }
      if (
        event.payload.test === "pink_noise" &&
        event.payload.message.toLowerCase().includes("error")
      ) {
        setPinkNoisePlaying(false);
        setInputMonitor((prev) => ({
          ...prev,
          status: "Pink noise error. Check output device/sample rate."
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
          splEstimate: current + 94
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
    calibrateLatencyGlobalImpulse,
    runSweepFrTest,
    runBalanceTest,
    runCrosstalkTest,
    runThdTest,
    runIsolationTest,
    exportLatencyReport,
    stopTest,
    copyLogs,
    clearLogs,
    clearResults
  };
}

export type PawdioLabController = ReturnType<typeof usePawdioLabController>;

/**
 * Typed IPC wrapper. One function per `#[tauri::command]` in src-tauri/src/main.rs.
 * Centralises every `invoke()` call so types are checked at the call site, not buried
 * inside string-keyed `invoke<T>("...")` calls in components.
 *
 * Add a new command here when you add one in Rust. Do not call `invoke()` directly
 * outside this file.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AncSnapshot,
  AudioSettings,
  BalanceRequest,
  CrosstalkRequest,
  DeviceInventory,
  IsolationRequest,
  LatencyReport,
  LatencyRequest,
  RuntimeStatus,
  SweepRequest,
  TestPayload,
  ThdRequest,
} from "../ui/model";

// Exact shape Rust accepts for ANC plot export
export type AncPlotMode = {
  key: string;
  label: string;
  attenuationLeft: number[];
  attenuationRight: number[];
};

// Exact shape Rust accepts for the latency suite export entries
export type LatencyExportEntry = {
  request: LatencyRequest;
  report: LatencyReport;
};

// Lifecycle / status ---------------------------------------------------------

export const getRuntimeStatus = (): Promise<RuntimeStatus> =>
  invoke<RuntimeStatus>("get_runtime_status");

export const stopTest = (): Promise<void> => invoke("stop_test");

// Devices / settings ---------------------------------------------------------

export const listAudioDevices = (): Promise<DeviceInventory> =>
  invoke<DeviceInventory>("list_audio_devices");

export const getAudioSettings = (): Promise<AudioSettings> =>
  invoke<AudioSettings>("get_audio_settings");

export const setAudioSettings = (
  settings: AudioSettings,
): Promise<AudioSettings> =>
  invoke<AudioSettings>("set_audio_settings", { settings });

// Tests ----------------------------------------------------------------------

export const runLatencyTest = (
  request: LatencyRequest,
): Promise<LatencyReport> =>
  invoke<LatencyReport>("run_latency_test", { request });

export const runSweepFrTest = (request: SweepRequest): Promise<TestPayload> =>
  invoke<TestPayload>("run_sweep_fr_test", { request });

export const runThdTest = (request: ThdRequest): Promise<TestPayload> =>
  invoke<TestPayload>("run_thd_test", { request });

export const runBalanceTest = (request: BalanceRequest): Promise<TestPayload> =>
  invoke<TestPayload>("run_balance_test", { request });

export const runCrosstalkTest = (
  request: CrosstalkRequest,
): Promise<TestPayload> =>
  invoke<TestPayload>("run_crosstalk_test", { request });

export const runIsolationTest = (
  request: IsolationRequest,
): Promise<TestPayload> =>
  invoke<TestPayload>("run_isolation_test", { request });

// Monitor / pink noise -------------------------------------------------------

export const startInputMonitor = (): Promise<void> =>
  invoke("start_input_monitor");

export const stopInputMonitor = (): Promise<void> =>
  invoke("stop_input_monitor");

export const resetInputMonitorPeak = (): Promise<void> =>
  invoke("reset_input_monitor_peak");

export const startPinkNoise = (): Promise<void> => invoke("start_pink_noise");

export const stopPinkNoise = (): Promise<void> => invoke("stop_pink_noise");

// Exports --------------------------------------------------------------------

export const exportLatencyReport = (
  request: LatencyRequest,
  report: LatencyReport,
  suite?: LatencyExportEntry[],
): Promise<string> =>
  invoke<string>("export_latency_report", { request, report, suite });

export const saveLatencyOverallBarChart = (
  request: LatencyRequest,
  suite: LatencyExportEntry[],
): Promise<string> =>
  invoke<string>("save_latency_overall_bar_chart", { request, suite });

export const writeSquiglinkCombined = (params: {
  outputPath: string;
  freqs: number[];
  leftDb: number[];
  rightDb: number[];
}): Promise<void> => invoke("write_squiglink_combined", params);

/**
 * Regenerate the aggregate sweep plots (All Sweeps / Average of All /
 * Left+Right Average) from both sides' curves. Used after a guided mono run
 * combines two single-side sweeps so the aggregate plots include both buds.
 */
export const saveSweepCombinedPlots = (params: {
  allPlotPath?: string;
  avgAllPlotPath?: string;
  lrAvgPlotPath?: string;
  freqs: number[];
  allCurves: number[][];
  avgAll: number[];
  leftAvg: number[];
  rightAvg: number[];
}): Promise<void> => invoke("save_sweep_combined_plots", params);

export const ensureOutputDir = (path: string): Promise<void> =>
  invoke("ensure_output_dir", { path });

// ANC ------------------------------------------------------------------------

export type AncSnapshotRequestShape = {
  f0: number;
  f1: number;
  durationSecs: number;
  repeats: number;
  amplitude: number;
  /** Which channel(s) to drive/record. Omit/`both` = stereo (existing behaviour). */
  captureSide?: "both" | "left" | "right";
};

export const captureAncSnapshot = (
  request: AncSnapshotRequestShape,
): Promise<AncSnapshot> =>
  invoke<AncSnapshot>("capture_anc_snapshot", { request });

export const saveAncPlots = (params: {
  outputDir: string;
  timestamp: string;
  freqs: number[];
  modes: AncPlotMode[];
}): Promise<Array<[string, string]>> =>
  invoke<Array<[string, string]>>("save_anc_plots", params);

export const saveAncSquiglink = (params: {
  outputPath: string;
  modeLabel: string;
  freqs: number[];
  attenuationDb: number[];
}): Promise<void> => invoke("save_anc_squiglink", params);

// Untyped escape hatch for the dynamic dispatch in runPayloadTest -------------

/**
 * Used by `runPayloadTest()` which dispatches by command string. Prefer the
 * concrete `run*Test` wrappers above when you know the command at the call site.
 */
export const runPayloadTestRaw = (
  command:
    | "run_sweep_fr_test"
    | "run_thd_test"
    | "run_balance_test"
    | "run_crosstalk_test"
    | "run_isolation_test",
  request: unknown,
): Promise<TestPayload> => invoke<TestPayload>(command, { request });

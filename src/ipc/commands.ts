/**
 * Typed IPC wrapper. One function per `#[tauri::command]` in src-tauri/src/main.rs.
 * Centralises every `invoke()` call so types are checked at the call site, not buried
 * inside string-keyed `invoke<T>("...")` calls in components.
 *
 * Add a new command here when you add one in Rust. Do not call `invoke()` directly
 * outside this file.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AncSnapshot,
  AudioSettings,
  BalanceRequest,
  CrosstalkRequest,
  DeviceInventory,
  DeviceRecord,
  LatencyProgress,
  LatencyReport,
  LatencyRequest,
  LibraryTestType,
  MeasurementRecord,
  MeasurementSummary,
  RuntimeStatus,
  SweepRequest,
  TestPayload,
  TestProgress,
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

/**
 * Open a URL in the system browser. Rust rejects anything outside the
 * project's own GitHub host, so this is only usable for the update check.
 */
export const openExternalUrl = (url: string): Promise<void> =>
  invoke("open_external_url", { url });

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

/**
 * Write the Sweep FR plots and Squiglink files for a set of accepted sweeps.
 * Returns the written files keyed like a sweep payload's `files`.
 */
export const saveSweepOutputs = (params: {
  outputDir: string | null;
  runTag: string;
  savePlots: boolean;
  saveSquiglink: boolean;
  freqs: number[];
  leftCurves: number[][];
  rightCurves: number[][];
}): Promise<Record<string, string>> =>
  invoke<Record<string, string>>("save_sweep_outputs", params);

export const writeTextExport = (params: {
  outputDir: string;
  filename: string;
  content: string;
}): Promise<string> => invoke<string>("write_text_export", params);

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
  outputDir: string | null;
  timestamp: string;
  freqs: number[];
  modes: AncPlotMode[];
}): Promise<Array<[string, string]>> =>
  invoke<Array<[string, string]>>("save_anc_plots", params);

export const saveAncSquiglink = (params: {
  outputDir: string | null;
  timestamp: string;
  modeKey: string;
  modeLabel: string;
  freqs: number[];
  attenuationDb: number[];
}): Promise<string> => invoke<string>("save_anc_squiglink", params);

// Measurement library / DB ---------------------------------------------------
// SQLite-backed persistence (src-tauri/src/db.rs). Tauri maps these camelCase
// argument keys to the snake_case Rust parameters automatically.

export const dbListDevices = (): Promise<DeviceRecord[]> =>
  invoke<DeviceRecord[]>("db_list_devices");

export const dbCreateDevice = (
  name: string,
  kind?: string,
): Promise<DeviceRecord> =>
  invoke<DeviceRecord>("db_create_device", { name, kind });

export const dbRenameDevice = (
  id: number,
  name: string,
): Promise<DeviceRecord> =>
  invoke<DeviceRecord>("db_rename_device", { id, name });

export const dbDeleteDevice = (id: number): Promise<void> =>
  invoke("db_delete_device", { id });

export const dbListMeasurements = (
  deviceId?: number,
  testType?: LibraryTestType,
): Promise<MeasurementSummary[]> =>
  invoke<MeasurementSummary[]>("db_list_measurements", { deviceId, testType });

export const dbGetMeasurement = (id: number): Promise<MeasurementRecord> =>
  invoke<MeasurementRecord>("db_get_measurement", { id });

/** `capturedAt` defaults to now; imports pass the original capture time. */
export const dbSaveMeasurement = (params: {
  deviceId: number;
  testType: LibraryTestType;
  label?: string;
  notes?: string;
  capturedAt?: number;
  payload: MeasurementRecord["payload"];
}): Promise<MeasurementRecord> =>
  invoke<MeasurementRecord>("db_save_measurement", params);

/** Replace a measurement's label and notes (blank clears). */
export const dbUpdateMeasurement = (
  id: number,
  label: string,
  notes: string,
): Promise<MeasurementRecord> =>
  invoke<MeasurementRecord>("db_update_measurement", { id, label, notes });

export const dbDeleteMeasurement = (id: number): Promise<void> =>
  invoke("db_delete_measurement", { id });

// Events ---------------------------------------------------------------------

export type InputLevelEvent = {
  currentDbfs: number;
  peakDbfs: number;
  clipCount: number;
  roughFrHz?: number[];
  roughFrDb?: number[];
};

export const onLatencyProgress = (
  handler: (progress: LatencyProgress) => void,
): Promise<UnlistenFn> =>
  listen<LatencyProgress>("latency-progress", (event) =>
    handler(event.payload),
  );

export const onTestProgress = (
  handler: (progress: TestProgress) => void,
): Promise<UnlistenFn> =>
  listen<TestProgress>("test-progress", (event) => handler(event.payload));

export const onInputLevel = (
  handler: (level: InputLevelEvent) => void,
): Promise<UnlistenFn> =>
  listen<InputLevelEvent>("input-level", (event) => handler(event.payload));

// Dialogs --------------------------------------------------------------------

/** Ask for a folder. Resolves to null when the user cancels. */
export async function pickDirectory(
  defaultPath?: string,
): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: defaultPath || undefined,
  });
  return typeof selected === "string" && selected.length > 0 ? selected : null;
}

/** Ask where to save a file. Resolves to null when the user cancels. */
export async function pickSavePath(
  defaultName: string,
  extension: string,
): Promise<string | null> {
  const selected = await save({
    defaultPath: defaultName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  return typeof selected === "string" && selected.length > 0 ? selected : null;
}

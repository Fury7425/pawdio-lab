import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  AudioSettings,
  CrosstalkRequest,
  DeviceInventory,
  IsolationRequest,
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
  defaultLatencyRequest,
  defaultSettings,
  defaultSweepRequest,
  defaultThdRequest,
  legacyTimestamp,
  parseToneList
} from "./model";

export function usePawdioLabController() {
  const [activePage, setActivePage] = useState<PageKey>("latency");
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(defaultSettings);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latencyRequest, setLatencyRequest] = useState<LatencyRequest>(defaultLatencyRequest);
  const [latencyProgress, setLatencyProgress] = useState<LatencyProgress[]>([]);
  const [latencyReport, setLatencyReport] = useState<LatencyReport | null>(null);

  const [sweepRequest, setSweepRequest] = useState<SweepRequest>(defaultSweepRequest);
  const [balanceRequest, setBalanceRequest] = useState(defaultBalanceRequest);
  const [crosstalkRequest, setCrosstalkRequest] = useState<CrosstalkRequest>(defaultCrosstalkRequest);
  const [thdRequest, setThdRequest] = useState<ThdRequest>(defaultThdRequest);
  const [thdToneText, setThdToneText] = useState(defaultThdRequest.tones.join(", "));
  const [isolationRequest, setIsolationRequest] = useState<IsolationRequest>(defaultIsolationRequest);

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
      const merged = { ...liveSettings };
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
    setSettings(next);
    try {
      const committed = await invoke<AudioSettings>("set_audio_settings", { settings: next });
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

  async function runLatencyTest() {
    if (running) {
      return;
    }

    setRunning(true);
    setError(null);
    setLatencyProgress([]);
    setLatencyReport(null);
    appendLog(`[latency] started (${latencyRequest.signal})`);

    try {
      const report = await invoke<LatencyReport>("run_latency_test", {
        request: latencyRequest
      });
      setLatencyReport(report);
      appendResult({
        test: "latency",
        timestamp: legacyTimestamp(report.timestampUtc),
        params: {
          signal: latencyRequest.signal,
          frequency_hz: latencyRequest.frequencyHz,
          duration: latencyRequest.durationSecs,
          repeats: latencyRequest.repeats,
          amplitude: latencyRequest.amplitude,
          record_margin: latencyRequest.recordMarginSecs
        },
        metrics: {
          average_delay_ms: report.averageDelayMs,
          std_dev_ms: report.stdDevMs,
          cancelled: report.cancelled
        },
        data: {
          sample_rate: report.sampleRate,
          input_sample_rate: report.inputSampleRate,
          measurements: report.measurements
        },
        files: {}
      });
    } catch (err) {
      setError(String(err));
      appendLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntimeStatus().catch(() => undefined);
    }
  }

  async function runSweepFrTest() {
    await runPayloadTest("run_sweep_fr_test", sweepRequest, "[SWEEP FR] running");
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
    const timer = setInterval(() => {
      refreshRuntimeStatus().catch(() => undefined);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let offLatency: null | (() => void) = null;
    let offProgress: null | (() => void) = null;

    listen<LatencyProgress>("latency-progress", (event) => {
      setLatencyProgress((prev) => [...prev, event.payload]);
    })
      .then((off) => {
        offLatency = off;
      })
      .catch((err) => setError(String(err)));

    listen<TestProgress>("test-progress", (event) => {
      appendLog(`[${event.payload.test}] ${event.payload.message}`);
    })
      .then((off) => {
        offProgress = off;
      })
      .catch((err) => setError(String(err)));

    return () => {
      if (offLatency) {
        offLatency();
      }
      if (offProgress) {
        offProgress();
      }
    };
  }, []);

  return {
    activePage,
    setActivePage,
    inventory,
    settings,
    running,
    error,
    latencyRequest,
    setLatencyRequest,
    latencyProgress,
    latencyReport,
    sweepRequest,
    setSweepRequest,
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

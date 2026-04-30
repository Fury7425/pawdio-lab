import { useState } from "react";
import * as ipc from "../../ipc/commands";

export type InputMonitorState = {
  monitoring: boolean;
  status: string;
  currentDbfs: number;
  peakDbfs: number;
  clipCount: number;
  splEstimate: number;
  roughFrHz: number[];
  roughFrDb: number[];
};

export const DEFAULT_INPUT_MONITOR: InputMonitorState = {
  monitoring: false,
  status: "Idle",
  currentDbfs: -96,
  peakDbfs: -96,
  clipCount: 0,
  splEstimate: -2,
  roughFrHz: [],
  roughFrDb: [],
};

type Deps = {
  isRunning: () => boolean;
  appendLog: (message: string) => void;
  setError: (err: string) => void;
};

/**
 * Combined input-monitor + pink-noise hook. They are split here from the main
 * controller because they're orthogonal to test orchestration, but kept in one
 * hook because they share the `inputMonitor` state slot (e.g. pink noise can
 * update the monitor's status text).
 *
 * The `Deps` parameter lets the hook talk to the kernel (running flag, log,
 * error) without taking a hard dependency on the controller.
 */
export function useMonitorAndNoise({ isRunning, appendLog, setError }: Deps) {
  const [inputMonitor, setInputMonitor] = useState<InputMonitorState>(DEFAULT_INPUT_MONITOR);
  const [pinkNoisePlaying, setPinkNoisePlaying] = useState(false);

  async function startInputMonitor() {
    if (isRunning()) {
      appendLog("[monitor] cannot start while a test is running");
      return;
    }
    try {
      try {
        await ipc.stopInputMonitor();
      } catch {
        // no-op
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 120);
      });
      await ipc.startInputMonitor();
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
      await ipc.stopInputMonitor();
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
    if (isRunning()) {
      appendLog("[pink-noise] cannot start while a test is running");
      return;
    }
    try {
      try {
        await ipc.stopPinkNoise();
      } catch {
        // no-op
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 80);
      });
      await ipc.startPinkNoise();
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
      await ipc.stopPinkNoise();
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
      await ipc.resetInputMonitorPeak();
    } catch {
      // reset locally even if backend reset command is unavailable.
    }
    setInputMonitor((prev) => ({
      ...prev,
      peakDbfs: prev.currentDbfs,
      clipCount: 0,
    }));
  }

  return {
    inputMonitor,
    setInputMonitor,
    pinkNoisePlaying,
    setPinkNoisePlaying,
    startInputMonitor,
    stopInputMonitor,
    startPinkNoise,
    stopPinkNoise,
    resetInputMonitorPeak,
  };
}

export type MonitorAndNoise = ReturnType<typeof useMonitorAndNoise>;

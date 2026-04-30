import { useMemo, useRef, useState } from "react";
import type {
  AudioSettings,
  DeviceInventory,
  ResultEntry,
  TestPayload,
} from "../model";

type Deps = {
  /** Optional accessors so result records can include device-name context. */
  getSettings?: () => AudioSettings | null;
  getInventory?: () => DeviceInventory | null;
};

/**
 * Logs + results buffer + the helpers that mutate them.
 *
 * Split from the main controller because they're called from every test
 * orchestrator but have no dependency on test-specific state. Other hooks
 * call `appendLog` and `appendResult`; tests/UI read `logs`, `results`,
 * `logText`.
 */
export function useResultsLog({ getSettings, getInventory }: Deps = {}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const nextResultId = useRef(1);
  const logText = useMemo(() => logs.join("\n"), [logs]);

  function appendLog(message: string) {
    const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, `[${stamp}] ${message}`]);
  }

  function appendResult(payload: TestPayload) {
    const settings = getSettings?.() ?? null;
    const inventory = getInventory?.() ?? null;

    let deviceName = "Unknown Device";
    if (settings) {
      if (settings.itemName && settings.itemName.trim()) {
        deviceName = settings.itemName.trim();
      } else if (inventory) {
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
    appendLog(`[${payload.test}] result recorded`);
    const fileEntries = Object.entries(payload.files ?? {});
    for (const [key, value] of fileEntries) {
      if (typeof value === "string" && value.length > 0) {
        appendLog(`[${payload.test}] ${key} -> ${value}`);
      }
    }
  }

  async function copyLogs() {
    await navigator.clipboard.writeText(logText);
    appendLog("[results] log copied");
  }

  function clearLogs() {
    setLogs([]);
  }

  return {
    logs,
    setLogs,
    results,
    setResults,
    logText,
    appendLog,
    appendResult,
    copyLogs,
    clearLogs,
  };
}

export type ResultsLog = ReturnType<typeof useResultsLog>;

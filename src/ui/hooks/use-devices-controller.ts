import { useState } from "react";
import * as ipc from "../../ipc/commands";
import type { AudioSettings, DeviceInventory } from "../model";

type Deps = {
  initialSettings: AudioSettings;
  setError: (err: string) => void;
};

/**
 * Owns audio device inventory + persisted audio settings + the IPC handshake
 * for refreshing devices and committing setting changes.
 *
 * Tests/UI READ inventory + settings; only this hook writes to them.
 */
export function useDevicesController({ initialSettings, setError }: Deps) {
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(initialSettings);

  async function loadState() {
    try {
      const [devices, liveSettings] = await Promise.all([
        ipc.listAudioDevices(),
        ipc.getAudioSettings(),
      ]);

      setInventory(devices);
      const merged = { ...liveSettings, ...settings };
      const outputIndices = new Set(devices.outputs.map((d) => d.index));
      const inputIndices = new Set(devices.inputs.map((d) => d.index));
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
      // Fall back to system default only if nothing currently selected
      if (
        merged.outputDeviceIndex === null &&
        devices.defaultOutputIndex !== null
      ) {
        merged.outputDeviceIndex = devices.defaultOutputIndex;
      }
      if (
        merged.inputDeviceIndex === null &&
        devices.defaultInputIndex !== null
      ) {
        merged.inputDeviceIndex = devices.defaultInputIndex;
      }
      const committed = await ipc.setAudioSettings(merged);
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function commitSettings(next: AudioSettings) {
    const normalized = { ...next };
    if (inventory) {
      const outputIndices = new Set(inventory.outputs.map((d) => d.index));
      const inputIndices = new Set(inventory.inputs.map((d) => d.index));
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
      const committed = await ipc.setAudioSettings(normalized);
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  return {
    inventory,
    setInventory,
    settings,
    setSettings,
    loadState,
    commitSettings,
  };
}

export type DevicesController = ReturnType<typeof useDevicesController>;

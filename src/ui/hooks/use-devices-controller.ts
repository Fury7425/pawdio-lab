import { useState } from "react";
import * as ipc from "../../ipc/commands";
import type { AudioDeviceInfo, AudioSettings, DeviceInventory } from "../model";

/** Find a saved device: by name when there is one, else by index. */
function findDevice(
  devices: AudioDeviceInfo[],
  index: number | null,
  name: string | null | undefined,
): AudioDeviceInfo | undefined {
  if (name) {
    const named = devices.filter((device) => device.name === name);
    return named.find((device) => device.index === index) ?? named[0];
  }
  return devices.find((device) => device.index === index);
}

function byIndex(
  devices: AudioDeviceInfo[],
  index: number | null,
): AudioDeviceInfo | undefined {
  return index === null
    ? undefined
    : devices.find((device) => device.index === index);
}

/**
 * Re-resolve a persisted selection against a fresh inventory. A device that has
 * moved in the list is found by name; one that is gone falls back to the
 * system default rather than to whatever now sits at its old index.
 */
export function restoreDeviceSelection(
  settings: AudioSettings,
  inventory: DeviceInventory,
): AudioSettings {
  const output =
    findDevice(
      inventory.outputs,
      settings.outputDeviceIndex,
      settings.outputDeviceName,
    ) ?? byIndex(inventory.outputs, inventory.defaultOutputIndex);
  const input =
    findDevice(
      inventory.inputs,
      settings.inputDeviceIndex,
      settings.inputDeviceName,
    ) ?? byIndex(inventory.inputs, inventory.defaultInputIndex);
  return {
    ...settings,
    outputDeviceIndex: output?.index ?? null,
    outputDeviceName: output?.name ?? null,
    inputDeviceIndex: input?.index ?? null,
    inputDeviceName: input?.name ?? null,
  };
}

/**
 * Apply a selection the user just made: the index is authoritative and the
 * name is recorded from the inventory. An index no longer listed falls back to
 * the system default device.
 */
export function applyDeviceSelection(
  settings: AudioSettings,
  inventory: DeviceInventory,
): AudioSettings {
  // "System Default" (null) stays unpinned so it follows the OS default.
  const output =
    settings.outputDeviceIndex === null
      ? undefined
      : (byIndex(inventory.outputs, settings.outputDeviceIndex) ??
        byIndex(inventory.outputs, inventory.defaultOutputIndex));
  const input =
    settings.inputDeviceIndex === null
      ? undefined
      : (byIndex(inventory.inputs, settings.inputDeviceIndex) ??
        byIndex(inventory.inputs, inventory.defaultInputIndex));
  return {
    ...settings,
    outputDeviceIndex: output?.index ?? null,
    outputDeviceName: output?.name ?? null,
    inputDeviceIndex: input?.index ?? null,
    inputDeviceName: input?.name ?? null,
  };
}

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
      const merged = restoreDeviceSelection(
        { ...liveSettings, ...settings },
        devices,
      );
      const committed = await ipc.setAudioSettings(merged);
      setSettings(committed);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function commitSettings(next: AudioSettings) {
    const normalized = inventory ? applyDeviceSelection(next, inventory) : next;
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

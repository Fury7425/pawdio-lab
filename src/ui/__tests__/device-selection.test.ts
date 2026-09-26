import { describe, expect, it } from "vitest";
import {
  applyDeviceSelection,
  restoreDeviceSelection,
} from "../hooks/use-devices-controller";
import { defaultSettings, type DeviceInventory } from "../model";

const device = (index: number, name: string, isInput: boolean) => ({
  index,
  name,
  isInput,
  channels: 2,
  defaultSampleRate: 48000,
});

const inventory: DeviceInventory = {
  outputs: [device(0, "Speakers", false), device(3, "Headphones", false)],
  inputs: [device(1, "USB Dongle", true), device(2, "Mic", true)],
  defaultOutputIndex: 0,
  defaultInputIndex: 1,
};

describe("restoreDeviceSelection", () => {
  it("finds a device that moved in the list by its name", () => {
    const restored = restoreDeviceSelection(
      {
        ...defaultSettings,
        inputDeviceIndex: 1,
        inputDeviceName: "Mic",
        outputDeviceIndex: 3,
        outputDeviceName: "Headphones",
      },
      inventory,
    );
    expect(restored.inputDeviceIndex).toBe(2);
    expect(restored.outputDeviceIndex).toBe(3);
  });

  it("falls back to the default when the named device is gone", () => {
    const restored = restoreDeviceSelection(
      { ...defaultSettings, inputDeviceIndex: 2, inputDeviceName: "Headset" },
      inventory,
    );
    expect(restored.inputDeviceIndex).toBe(1);
    expect(restored.inputDeviceName).toBe("USB Dongle");
  });

  it("keeps resolving selections saved before names were stored", () => {
    const restored = restoreDeviceSelection(
      { ...defaultSettings, inputDeviceIndex: 2 },
      inventory,
    );
    expect(restored.inputDeviceName).toBe("Mic");
  });
});

describe("applyDeviceSelection", () => {
  it("records the picked device's name, not a stale one", () => {
    const applied = applyDeviceSelection(
      {
        ...defaultSettings,
        inputDeviceIndex: 2,
        inputDeviceName: "USB Dongle",
      },
      inventory,
    );
    expect(applied.inputDeviceName).toBe("Mic");
  });

  it("leaves System Default unpinned", () => {
    const applied = applyDeviceSelection(
      { ...defaultSettings, outputDeviceIndex: null },
      inventory,
    );
    expect(applied.outputDeviceIndex).toBeNull();
    expect(applied.outputDeviceName).toBeNull();
  });
});

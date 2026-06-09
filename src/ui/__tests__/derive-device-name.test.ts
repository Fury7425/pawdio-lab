import { describe, expect, it } from "vitest";
import { deriveDeviceName } from "../hooks/use-results-log";
import { defaultSettings, type DeviceInventory } from "../model";

const inventory: DeviceInventory = {
  inputs: [
    {
      index: 0,
      name: "USB Mic",
      isInput: true,
      channels: 1,
      defaultSampleRate: 48000,
    },
  ],
  outputs: [
    {
      index: 1,
      name: "Headphone Amp",
      isInput: false,
      channels: 2,
      defaultSampleRate: 48000,
    },
  ],
  defaultInputIndex: 0,
  defaultOutputIndex: 1,
};

describe("deriveDeviceName", () => {
  it("prefers a user-typed item name", () => {
    const settings = { ...defaultSettings, itemName: "  My Buds  " };
    expect(deriveDeviceName(settings, inventory)).toBe("My Buds");
  });

  it("falls back to the selected output device", () => {
    const settings = {
      ...defaultSettings,
      itemName: "",
      outputDeviceIndex: 1,
      inputDeviceIndex: 0,
    };
    expect(deriveDeviceName(settings, inventory)).toBe("Headphone Amp");
  });

  it("falls back to the input device when no output is selected", () => {
    const settings = {
      ...defaultSettings,
      itemName: "",
      outputDeviceIndex: null,
      inputDeviceIndex: 0,
    };
    expect(deriveDeviceName(settings, inventory)).toBe("USB Mic");
  });

  it("returns Unknown Device with no settings", () => {
    expect(deriveDeviceName(null, null)).toBe("Unknown Device");
  });
});

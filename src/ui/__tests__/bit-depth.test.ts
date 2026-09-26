import { afterEach, describe, expect, it } from "vitest";
import { initialAudioSettings } from "../use-pawdio-lab";

afterEach(() => window.localStorage.clear());

describe("initialAudioSettings bit depth", () => {
  it("defaults to auto", () => {
    expect(initialAudioSettings(undefined).inputBitDepth).toBe("auto");
  });

  it("keeps a saved depth", () => {
    expect(initialAudioSettings({ inputBitDepth: "24" }).inputBitDepth).toBe(
      "24",
    );
  });

  it("carries over the choice from the old device prefs once", () => {
    window.localStorage.setItem(
      "pawdio-lab-device-ui-v1",
      JSON.stringify({ appearanceMode: "Dark", inputBitDepth: "16" }),
    );
    expect(initialAudioSettings({}).inputBitDepth).toBe("16");
    window.localStorage.setItem(
      "pawdio-lab-device-ui-v1",
      JSON.stringify({ inputBitDepth: "Auto" }),
    );
    expect(initialAudioSettings({}).inputBitDepth).toBe("auto");
  });

  it("ignores an unknown value", () => {
    expect(initialAudioSettings({ inputBitDepth: "8" }).inputBitDepth).toBe(
      "auto",
    );
  });
});

import { useEffect, useMemo, useState } from "react";
import { AudioSettings, DeviceInventory, fromSelectValue, toNumber, toSelectValue } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_INPUT_BIT_DEPTH,
  DEFAULT_ACCENT_COLOR,
  DeviceUiPrefs,
  normalizeAccentColor,
  normalizeAppearanceMode,
  persistDeviceUiPrefs,
  readDeviceUiPrefs
} from "../theme";

type DevicesPageProps = {
  inventory: DeviceInventory | null;
  settings: AudioSettings;
  experimentalEnabled: boolean;
  onChangeExperimentalEnabled: (enabled: boolean) => void;
  onCommitSettings: (settings: AudioSettings) => void;
  onRefreshDevices: () => void;
};

export function DevicesPage({
  inventory,
  settings,
  experimentalEnabled,
  onChangeExperimentalEnabled,
  onCommitSettings,
  onRefreshDevices
}: DevicesPageProps) {
  const storedUiPrefs = useMemo(() => readDeviceUiPrefs(), []);
  const [draft, setDraft] = useState(settings);
  const [appearanceMode, setAppearanceMode] = useState(
    storedUiPrefs?.appearanceMode ?? DEFAULT_APPEARANCE_MODE
  );
  const [accentColor, setAccentColor] = useState(
    storedUiPrefs?.accentColor ?? DEFAULT_ACCENT_COLOR
  );
  const [inputBitDepth, setInputBitDepth] = useState(
    storedUiPrefs?.inputBitDepth ?? DEFAULT_INPUT_BIT_DEPTH
  );

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const snapshot: DeviceUiPrefs = {
      appearanceMode,
      accentColor,
      inputBitDepth
    };
    persistDeviceUiPrefs(snapshot);
  }, [appearanceMode, accentColor, inputBitDepth]);

  function commitDeviceSelection(next: AudioSettings) {
    setDraft(next);
    onCommitSettings(next);
  }

  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Devices / Settings</h2>

        <section className="page-card">
          <h3 className="section-subheading">Signal Settings</h3>

          <div className="field-grid-2">
            <label className="field-row">
              <span className="field-label">Output Sample Rate</span>
              <input
                className="skin-input"
                type="number"
                value={draft.outputSampleRate}
                onChange={(event: any) =>
                  setDraft((prev: AudioSettings) => ({
                    ...prev,
                    outputSampleRate: toNumber(event.target.value, 44100)
                  }))
                }
              />
            </label>
            <label className="field-row">
              <span className="field-label">Input Sample Rate</span>
              <input
                className="skin-input"
                type="number"
                value={draft.inputSampleRate}
                onChange={(event: any) =>
                  setDraft((prev: AudioSettings) => ({
                    ...prev,
                    inputSampleRate: toNumber(event.target.value, 44100)
                  }))
                }
              />
            </label>
          </div>

          <div className="field-grid-2" style={{ marginTop: 10 }}>
            <LabeledNumberInput
              label="Signal Duration (s)"
              value={draft.durationSecs}
              step={0.05}
              onChange={(event: any) =>
                setDraft((prev: AudioSettings) => ({
                  ...prev,
                  durationSecs: toNumber(event.target.value, 0.5)
                }))
              }
            />
            <label className="field-row">
              <span className="field-label">Input Bit Depth</span>
              <select
                className="skin-select"
                value={inputBitDepth}
                onChange={(event: any) => setInputBitDepth(event.target.value)}
              >
                <option value="Auto">Auto</option>
                <option value="16">16</option>
                <option value="24">24</option>
                <option value="32">32</option>
              </select>
            </label>
          </div>
          <label className="field-row" style={{ marginTop: 10 }}>
            <span className="field-label">Item Name</span>
            <input
              className="skin-input"
              value={draft.itemName}
              placeholder="e.g. HD600, Unit-A, My Headphone"
              onChange={(event: any) =>
                setDraft((prev: AudioSettings) => ({
                  ...prev,
                  itemName: event.target.value
                }))
              }
            />
          </label>

          <div className="row-end" style={{ marginTop: 12 }}>
            <button type="button" className="skin-btn" onClick={() => onCommitSettings(draft)}>
              Apply
            </button>
          </div>
        </section>

        <section className="page-card" style={{ marginTop: 12 }}>
          <h3 className="section-subheading">Audio Devices</h3>

          <div className="field-grid-4">
            <label className="field-row" style={{ gridColumn: "span 3" }}>
              <span className="field-label">Output Device</span>
              <select
                className="skin-select"
                value={toSelectValue(draft.outputDeviceIndex)}
                onChange={(event: any) =>
                  commitDeviceSelection({
                    ...draft,
                    outputDeviceIndex: fromSelectValue(event.target.value)
                  })
                }
              >
                <option value="none">System Default</option>
                {(inventory?.outputs ?? []).map((device) => (
                  <option key={device.index} value={String(device.index)}>
                    {device.name} ({device.channels}ch @ {device.defaultSampleRate}Hz)
                  </option>
                ))}
              </select>
            </label>

            <div className="row-end" style={{ alignItems: "end" }}>
              <button type="button" className="skin-btn secondary" onClick={onRefreshDevices}>
                Refresh Devices
              </button>
            </div>
          </div>

          <label className="field-row" style={{ marginTop: 10 }}>
            <span className="field-label">Input Device</span>
            <select
              className="skin-select"
              value={toSelectValue(draft.inputDeviceIndex)}
              onChange={(event: any) =>
                commitDeviceSelection({
                  ...draft,
                  inputDeviceIndex: fromSelectValue(event.target.value)
                })
              }
            >
              <option value="none">System Default</option>
              {(inventory?.inputs ?? []).map((device) => (
                <option key={device.index} value={String(device.index)}>
                  {device.name} ({device.channels}ch @ {device.defaultSampleRate}Hz)
                </option>
              ))}
            </select>
          </label>

          <LabeledNumberInput
            label="Chunk Size"
            value={draft.chunkSize}
            min={64}
            step={1}
            onChange={(event: any) =>
              setDraft((prev: AudioSettings) => ({
                ...prev,
                chunkSize: Math.max(64, Math.round(toNumber(event.target.value, 1024)))
              }))
            }
          />
        </section>

        <section className="page-card" style={{ marginTop: 12 }}>
          <h3 className="section-subheading">Appearance</h3>

          <div className="field-grid-2">
            <label className="field-row">
              <span className="field-label">Appearance Mode</span>
              <select
                className="skin-select"
                value={appearanceMode}
                onChange={(event: any) => setAppearanceMode(normalizeAppearanceMode(event.target.value))}
              >
                <option value="Dark">Dark</option>
                <option value="Light">Light</option>
                <option value="System">System</option>
              </select>
            </label>

            <label className="field-row">
              <span className="field-label">Accent Color</span>
              <select
                className="skin-select"
                value={accentColor}
                onChange={(event: any) => setAccentColor(normalizeAccentColor(event.target.value))}
              >
                <option value="Blue">Blue</option>
                <option value="Teal">Teal</option>
                <option value="Greyscale">Greyscale</option>
                <option value="Purple">Purple</option>
              </select>
            </label>
          </div>

          <label className="toggle-line" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={experimentalEnabled}
              onChange={(event: any) => onChangeExperimentalEnabled(event.target.checked)}
            />
            Enable Experimental Tests
          </label>
        </section>
      </section>
    </div>
  );
}

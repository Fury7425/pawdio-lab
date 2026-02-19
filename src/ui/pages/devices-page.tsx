import { useEffect, useState } from "react";
import { AudioSettings, DeviceInventory, fromSelectValue, toNumber, toSelectValue } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type DevicesPageProps = {
  inventory: DeviceInventory | null;
  settings: AudioSettings;
  onCommitSettings: (settings: AudioSettings) => void;
  onRefreshDevices: () => void;
};

export function DevicesPage({
  inventory,
  settings,
  onCommitSettings,
  onRefreshDevices
}: DevicesPageProps) {
  const [draft, setDraft] = useState(settings);
  const [appearanceMode, setAppearanceMode] = useState("Dark");
  const [accentColor, setAccentColor] = useState("Blue");
  const [experimentalEnabled, setExperimentalEnabled] = useState(true);
  const [inputBitDepth, setInputBitDepth] = useState("Auto");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

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
                onChange={(event) =>
                  setDraft((prev) => ({
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
                onChange={(event) =>
                  setDraft((prev) => ({
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
              onChange={(event) =>
                setDraft((prev) => ({
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
                onChange={(event) => setInputBitDepth(event.target.value)}
              >
                <option value="Auto">Auto</option>
                <option value="16">16</option>
                <option value="24">24</option>
                <option value="32">32</option>
              </select>
            </label>
          </div>

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
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    outputDeviceIndex: fromSelectValue(event.target.value)
                  }))
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
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  inputDeviceIndex: fromSelectValue(event.target.value)
                }))
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
            onChange={(event) =>
              setDraft((prev) => ({
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
                onChange={(event) => setAppearanceMode(event.target.value)}
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
                onChange={(event) => setAccentColor(event.target.value)}
              >
                <option value="Blue">Blue</option>
                <option value="Teal">Teal</option>
                <option value="Greyscale">Greyscale</option>
              </select>
            </label>
          </div>

          <label className="toggle-line" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={experimentalEnabled}
              onChange={(event) => setExperimentalEnabled(event.target.checked)}
            />
            Enable Experimental Tests
          </label>
        </section>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AudioSettings,
  fromSelectValue,
  toNumber,
  toSelectValue,
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import {
  ACCENT_COLORS,
  APPEARANCE_MODES,
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_INPUT_BIT_DEPTH,
  DEFAULT_ACCENT_COLOR,
  DeviceUiPrefs,
  normalizeAccentColor,
  normalizeAppearanceMode,
  persistDeviceUiPrefs,
  readDeviceUiPrefs,
} from "../theme";
import { usePawdioLabContext } from "../pawdio-context";

export function DevicesPage() {
  const ctx = usePawdioLabContext();
  const inventory = ctx.inventory;
  const settings = ctx.settings;
  const experimentalEnabled = ctx.experimentalEnabled;
  const onChangeExperimentalEnabled = ctx.setExperimentalEnabled;
  const onCommitSettings = (next: AudioSettings) =>
    ctx.run(ctx.commitSettings(next));
  const onRefreshDevices = () => ctx.run(ctx.loadState());
  const storedUiPrefs = useMemo(() => readDeviceUiPrefs(), []);
  const [draft, setDraft] = useState(settings);
  const [appearanceMode, setAppearanceMode] = useState(
    storedUiPrefs?.appearanceMode ?? DEFAULT_APPEARANCE_MODE,
  );
  const [accentColor, setAccentColor] = useState(
    storedUiPrefs?.accentColor ?? DEFAULT_ACCENT_COLOR,
  );
  const [inputBitDepth, setInputBitDepth] = useState(
    storedUiPrefs?.inputBitDepth ?? DEFAULT_INPUT_BIT_DEPTH,
  );

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const snapshot: DeviceUiPrefs = {
      appearanceMode,
      accentColor,
      inputBitDepth,
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

        <section className="page-section">
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
                    outputSampleRate: toNumber(event.target.value, 44100),
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
                    inputSampleRate: toNumber(event.target.value, 44100),
                  }))
                }
              />
            </label>
          </div>

          <div className="field-grid-2 mt-10">
            <LabeledNumberInput
              label="Signal Duration (s)"
              value={draft.durationSecs}
              step={0.05}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  durationSecs: toNumber(event.target.value, 0.5),
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

          <label className="field-row mt-10">
            <span className="field-label">Item Name</span>
            <input
              className="skin-input"
              value={draft.itemName}
              placeholder="e.g. HD600, Unit-A, My Headphone"
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  itemName: event.target.value,
                }))
              }
            />
          </label>

          <div className="row-end mt-12">
            <button
              type="button"
              className="skin-btn"
              onClick={() => onCommitSettings(draft)}
            >
              Apply
            </button>
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Audio Devices</h3>

          <div className="field-grid-4">
            <label className="field-row" style={{ gridColumn: "span 3" }}>
              <span className="field-label">Output Device</span>
              <select
                className="skin-select"
                value={toSelectValue(draft.outputDeviceIndex)}
                onChange={(event) =>
                  commitDeviceSelection({
                    ...draft,
                    outputDeviceIndex: fromSelectValue(event.target.value),
                  })
                }
              >
                <option value="none">System Default</option>
                {(inventory?.outputs ?? []).map((device) => (
                  <option key={device.index} value={String(device.index)}>
                    {device.name} ({device.channels}ch @{" "}
                    {device.defaultSampleRate}Hz)
                  </option>
                ))}
              </select>
            </label>

            <div className="row-end" style={{ alignItems: "end" }}>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={onRefreshDevices}
              >
                Refresh
              </button>
            </div>
          </div>

          <label className="field-row mt-10">
            <span className="field-label">Input Device</span>
            <select
              className="skin-select"
              value={toSelectValue(draft.inputDeviceIndex)}
              onChange={(event) =>
                commitDeviceSelection({
                  ...draft,
                  inputDeviceIndex: fromSelectValue(event.target.value),
                })
              }
            >
              <option value="none">System Default</option>
              {(inventory?.inputs ?? []).map((device) => (
                <option key={device.index} value={String(device.index)}>
                  {device.name} ({device.channels}ch @{" "}
                  {device.defaultSampleRate}Hz)
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
                chunkSize: Math.max(
                  64,
                  Math.round(toNumber(event.target.value, 1024)),
                ),
              }))
            }
          />
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Appearance</h3>

          <div className="field-grid-2">
            <label className="field-row">
              <span className="field-label">Appearance Mode</span>
              <select
                className="skin-select"
                value={appearanceMode}
                onChange={(event) =>
                  setAppearanceMode(normalizeAppearanceMode(event.target.value))
                }
              >
                {APPEARANCE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-row">
              <span className="field-label">Accent Color</span>
              <select
                className="skin-select"
                value={accentColor}
                onChange={(event) =>
                  setAccentColor(normalizeAccentColor(event.target.value))
                }
              >
                {ACCENT_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="toggle-line mt-10">
            <input
              type="checkbox"
              checked={experimentalEnabled}
              onChange={(event) =>
                onChangeExperimentalEnabled(event.target.checked)
              }
            />
            Enable Experimental Tests
          </label>
        </section>
      </section>
    </div>
  );
}

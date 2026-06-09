import { useEffect, useMemo, useState } from "react";
import {
  AudioSettings,
  fromSelectValue,
  toNumber,
  toSelectValue,
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { CheckboxField, SelectField } from "../components/form-fields";
import { PageHeader } from "../components/page-header";
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
        <PageHeader
          title="Devices / Settings"
          description="Audio devices, signal settings, and appearance."
        />

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
            <SelectField
              label="Input Bit Depth"
              value={inputBitDepth}
              onChange={setInputBitDepth}
              options={["Auto", "16", "24", "32"].map((depth) => ({
                value: depth,
                label: depth,
              }))}
            />
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
            <label className="field-row field-span-3">
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

            <div className="row-end align-end">
              <button
                type="button"
                className="skin-btn secondary"
                onClick={onRefreshDevices}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-10">
            <SelectField
              label="Input Device"
              value={toSelectValue(draft.inputDeviceIndex)}
              onChange={(value) =>
                commitDeviceSelection({
                  ...draft,
                  inputDeviceIndex: fromSelectValue(value),
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
            </SelectField>
          </div>

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
            <SelectField
              label="Appearance Mode"
              value={appearanceMode}
              onChange={(value) =>
                setAppearanceMode(normalizeAppearanceMode(value))
              }
              options={APPEARANCE_MODES.map((m) => ({ value: m, label: m }))}
            />

            <SelectField
              label="Accent Color"
              value={accentColor}
              onChange={(value) => setAccentColor(normalizeAccentColor(value))}
              options={ACCENT_COLORS.map((c) => ({ value: c, label: c }))}
            />
          </div>

          <div className="mt-10">
            <CheckboxField
              label="Enable Experimental Tests"
              checked={experimentalEnabled}
              onChange={onChangeExperimentalEnabled}
            />
          </div>
        </section>
      </section>
    </div>
  );
}

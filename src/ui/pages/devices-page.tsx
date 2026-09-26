import { useEffect, useState } from "react";
import {
  AudioSettings,
  INPUT_BIT_DEPTH_LABELS,
  type InputBitDepth,
  fromSelectValue,
  toNumber,
  toSelectValue,
} from "../model";
import { CheckboxField, SelectField } from "../components/form-fields";
import { PageHeader } from "../components/page-header";
import { usePawdioLabContext } from "../pawdio-context";
import { SplCalibrationPanel } from "../components/spl-calibration-panel";

export function DevicesPage() {
  const ctx = usePawdioLabContext();
  const inventory = ctx.inventory;
  const settings = ctx.settings;
  const onCommitSettings = (next: AudioSettings) =>
    ctx.run(ctx.commitSettings(next));
  const onRefreshDevices = () => ctx.run(ctx.loadState());
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // Depths the selected input offers ("System Default" resolves to the OS
  // default device). An empty list means the backend could not tell, so every
  // option stays available.
  const selectedInput = inventory?.inputs.find(
    (device) =>
      device.index ===
      (draft.inputDeviceIndex ?? inventory?.defaultInputIndex ?? null),
  );
  const offeredDepths = selectedInput?.bitDepths ?? [];
  const depthOptions: InputBitDepth[] = [
    "auto",
    ...(offeredDepths.length > 0
      ? offeredDepths
      : (["16", "24", "32"] as InputBitDepth[])),
  ];
  if (!depthOptions.includes(draft.inputBitDepth)) {
    depthOptions.push(draft.inputBitDepth);
  }
  const depthUnavailable =
    draft.inputBitDepth !== "auto" &&
    offeredDepths.length > 0 &&
    !offeredDepths.includes(draft.inputBitDepth);

  function commitDeviceSelection(next: AudioSettings) {
    setDraft(next);
    onCommitSettings(next);
  }

  const draftDirty =
    draft.outputSampleRate !== settings.outputSampleRate ||
    draft.inputSampleRate !== settings.inputSampleRate ||
    draft.itemName !== settings.itemName;

  return (
    <div className="page-stack">
      <section className="page-card">
        <PageHeader
          title="Devices"
          description="What plays the test signal, what records it, and how."
          actions={
            <button
              type="button"
              className="skin-btn secondary"
              onClick={onRefreshDevices}
            >
              Refresh devices
            </button>
          }
        />

        <div className="field-grid-2">
          <section className="page-card">
            <h3 className="section-subheading">Output</h3>
            <SelectField
              label="Device"
              value={toSelectValue(draft.outputDeviceIndex)}
              onChange={(value) =>
                commitDeviceSelection({
                  ...draft,
                  outputDeviceIndex: fromSelectValue(value),
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
            </SelectField>
            <label className="field-row mt-10">
              <span className="field-label">Sample rate (Hz)</span>
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
          </section>

          <section className="page-card">
            <h3 className="section-subheading">Input</h3>
            <SelectField
              label="Device"
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
            <div className="field-grid-2 mt-10">
              <label className="field-row">
                <span className="field-label">Sample rate (Hz)</span>
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
              <SelectField
                label="Bit depth"
                value={draft.inputBitDepth}
                onChange={(value) =>
                  commitDeviceSelection({
                    ...draft,
                    inputBitDepth: value as InputBitDepth,
                  })
                }
                options={depthOptions.map((depth) => ({
                  value: depth,
                  label: INPUT_BIT_DEPTH_LABELS[depth],
                }))}
              />
            </div>
            {depthUnavailable && (
              <p className="field-error compact-note mt-8">
                This input does not offer{" "}
                {INPUT_BIT_DEPTH_LABELS[draft.inputBitDepth]}, so captures use
                the device default.
              </p>
            )}
          </section>
        </div>

        <div className="field-grid-4 mt-12">
          <label className="field-row field-span-3">
            <span className="field-label">Item name</span>
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
          <div className="row-end align-end">
            <button
              type="button"
              className="skin-btn"
              disabled={!draftDirty}
              onClick={() => onCommitSettings(draft)}
            >
              Apply
            </button>
          </div>
        </div>
        <p className="muted compact-note mt-8">
          Devices and bit depth apply immediately. Sample rates and the item
          name apply when you press Apply.
        </p>
      </section>

      <section className="page-card">
        <h3 className="section-subheading">Wireless capture</h3>
        <CheckboxField
          label="Bluetooth / wireless device"
          checked={draft.bluetoothMode}
          onChange={(checked) =>
            commitDeviceSelection({ ...draft, bluetoothMode: checked })
          }
        />
        <p className="muted compact-note mt-8">
          A Bluetooth link resamples and buffers, so its clock never quite
          matches the capture clock. Wireless mode wraps each measurement signal
          in timing markers, widens the silences around it, and measures the
          drift so the recording can be corrected before it is analysed. Leave
          it off for wired gear. The latency test ignores this setting, because
          the link delay is what that test measures.
        </p>
      </section>

      <section className="page-card">
        <SplCalibrationPanel />
      </section>
    </div>
  );
}

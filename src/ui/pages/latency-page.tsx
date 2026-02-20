import { useEffect, useMemo, useState } from "react";
import { LatencyProgress, LatencyReport, LatencyRequest, fmtMs, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type LatencyPageProps = {
  request: LatencyRequest;
  onChangeRequest: (request: LatencyRequest) => void;
  progressRows: LatencyProgress[];
  report: LatencyReport | null;
  calibrationText: string;
  running: boolean;
  progressPercent: number;
  onRunSelected: (keys: Array<"beep1k" | "beep2k" | "beep5k" | "beep200" | "impulse">) => void;
  onRunAll: () => void;
  onSaveReport: () => void;
  onCalibrateSelected: (
    keys: Array<"beep1k" | "beep2k" | "beep5k" | "beep200" | "impulse">,
    repeats: number
  ) => void;
  onCalibrateAll: (repeats: number) => void;
};

const LATENCY_UI_STORAGE_KEY = "pawdio-lab-latency-ui-v1";

type PresetSelection = {
  beep200: boolean;
  beep1k: boolean;
  beep2k: boolean;
  beep5k: boolean;
  impulse: boolean;
};

type LatencyUiPrefs = {
  runSelection: PresetSelection;
  calibrationRepeats: number;
  calibrationMode: PresetSelection;
};

function readLatencyUiPrefs(): LatencyUiPrefs | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LATENCY_UI_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as LatencyUiPrefs;
  } catch {
    return null;
  }
}

export function LatencyPage({
  request,
  onChangeRequest,
  progressRows,
  report,
  calibrationText,
  running,
  progressPercent,
  onRunSelected,
  onRunAll,
  onSaveReport,
  onCalibrateSelected,
  onCalibrateAll
}: LatencyPageProps) {
  const storedUiPrefs = useMemo(() => readLatencyUiPrefs(), []);
  const [runSelection, setRunSelection] = useState<PresetSelection>(
    storedUiPrefs?.runSelection ?? {
      beep200: true,
      beep1k: true,
      beep2k: true,
      beep5k: true,
      impulse: false
    }
  );
  const [calibrationRepeats, setCalibrationRepeats] = useState(
    storedUiPrefs?.calibrationRepeats ?? 5
  );
  const [calibrationMode, setCalibrationMode] = useState<PresetSelection>(
    storedUiPrefs?.calibrationMode ?? {
      beep200: true,
      beep1k: true,
      beep2k: true,
      beep5k: true,
      impulse: true
    }
  );

  useEffect(() => {
    const snapshot: LatencyUiPrefs = {
      runSelection,
      calibrationRepeats,
      calibrationMode
    };
    try {
      localStorage.setItem(LATENCY_UI_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage write failures
    }
  }, [runSelection, calibrationRepeats, calibrationMode]);

  const breakdownText = useMemo(() => {
    if (progressRows.length === 0) {
      return "Waiting for latency data...";
    }

    return progressRows
      .map((row) => `${row.current}/${row.total}  |  delay=${fmtMs(row.delayMs)}`)
      .join("\n");
  }, [progressRows]);

  const lastDelay = progressRows.length > 0 ? progressRows[progressRows.length - 1].delayMs : null;

  const presetOptions = [
    { key: "beep200", label: "200Hz Low Beep", signal: "sine" as const, frequencyHz: 200 },
    { key: "beep1k", label: "1kHz Beep", signal: "sine" as const, frequencyHz: 1000 },
    { key: "beep2k", label: "Mixed (2kHz Sine)", signal: "sine" as const, frequencyHz: 2000 },
    { key: "beep5k", label: "5kHz Beep", signal: "sine" as const, frequencyHz: 5000 },
    { key: "impulse", label: "Click (Impulse)", signal: "impulse" as const, frequencyHz: request.frequencyHz }
  ];

  function isRunPresetEnabled(key: keyof typeof runSelection) {
    return runSelection[key];
  }

  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Latency</h2>

        <section className="page-card">
          <h3 className="section-subheading">Run Delay Tests</h3>

          <div className="chip-row">
            {presetOptions.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={`chip-btn ${isRunPresetEnabled(preset.key as keyof typeof runSelection) ? "is-on" : ""}`.trim()}
                onClick={() =>
                  setRunSelection((prev) => ({
                    ...prev,
                    [preset.key]: !prev[preset.key as keyof typeof prev]
                  }))
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="range-line" style={{ marginTop: 12 }}>
            <span className="field-label">Repeats</span>
            <input
              className="skin-range"
              type="range"
              min={1}
              max={20}
              step={1}
              value={request.repeats}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  repeats: Math.max(1, Math.round(toNumber(event.target.value, 5)))
                })
              }
            />
            <span>{request.repeats}</span>
          </div>

          <div className="field-grid-4" style={{ marginTop: 12 }}>
            <LabeledNumberInput
              label="Frequency (Hz)"
              value={request.frequencyHz}
              onChange={(event) =>
                onChangeRequest({ ...request, frequencyHz: toNumber(event.target.value, 1000) })
              }
            />
            <LabeledNumberInput
              label="Duration (s)"
              value={request.durationSecs}
              step={0.05}
              onChange={(event) =>
                onChangeRequest({ ...request, durationSecs: toNumber(event.target.value, 0.5) })
              }
            />
            <LabeledNumberInput
              label="Amplitude"
              value={request.amplitude}
              step={0.05}
              min={0}
              max={1}
              onChange={(event) =>
                onChangeRequest({ ...request, amplitude: toNumber(event.target.value, 0.85) })
              }
            />
            <LabeledNumberInput
              label="Record Margin (s)"
              value={request.recordMarginSecs}
              step={0.1}
              min={0.1}
              onChange={(event) =>
                onChangeRequest({ ...request, recordMarginSecs: toNumber(event.target.value, 1) })
              }
            />
          </div>

          <div className="field-grid-2" style={{ marginTop: 12 }}>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={request.savePerSoundPlot}
                onChange={(event) =>
                  onChangeRequest({
                    ...request,
                    savePerSoundPlot: event.target.checked
                  })
                }
              />
              Save per-sound plot
            </label>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={request.saveOverallBarChart}
                onChange={(event) =>
                  onChangeRequest({
                    ...request,
                    saveOverallBarChart: event.target.checked
                  })
                }
              />
              Save overall bar chart
            </label>
          </div>

          <div className="field-grid-4" style={{ marginTop: 12 }}>
            <label className="field-row" style={{ gridColumn: "span 3" }}>
              <span className="field-label">Output Folder</span>
              <input
                className="skin-input"
                value={request.outputDir}
                placeholder="Select output folder"
                onChange={(event) => onChangeRequest({ ...request, outputDir: event.target.value })}
              />
            </label>
            <div className="row-end" style={{ alignItems: "end" }}>
              <button type="button" className="skin-btn secondary">
                Browse
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap"
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="skin-btn"
                disabled={running}
                onClick={() => {
                  const keys = (Object.entries(runSelection) as Array<
                    ["beep200" | "beep1k" | "beep2k" | "beep5k" | "impulse", boolean]
                  >)
                    .filter(([, enabled]) => enabled)
                    .map(([key]) => key)
                    .sort((a, b) => {
                      const order = ["beep1k", "beep2k", "beep5k", "beep200", "impulse"];
                      return order.indexOf(a) - order.indexOf(b);
                    });
                  onRunSelected(keys);
                }}
              >
                Run Selected
              </button>
              <button type="button" className="skin-btn secondary" disabled={running} onClick={onRunAll}>
                Run ALL
              </button>
            </div>
            <button
              type="button"
              className="skin-btn secondary"
              disabled={!report || running}
              onClick={onSaveReport}
            >
              Save Text Report
            </button>
          </div>
        </section>

        <section className="page-card" style={{ marginTop: 12 }}>
          <h3 className="section-subheading">Results Summary</h3>

          <div className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Average (ms)</p>
              <p className="metric-value">{fmtMs(report?.averageDelayMs ?? null)}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Std Dev (ms)</p>
              <p className="metric-value">{fmtMs(report?.stdDevMs ?? null)}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Last (ms)</p>
              <p className="metric-value">{fmtMs(lastDelay)}</p>
            </article>
          </div>

          <div style={{ marginTop: 10 }}>
            <p className="field-label">
              Detailed Breakdown | Progress {progressPercent}% | Signal {request.signal}
            </p>
            <div className="scroll-box">
              <pre className="mono-pre">{breakdownText}</pre>
            </div>
          </div>
        </section>

        <section className="page-card" style={{ marginTop: 12 }}>
          <h3 className="section-subheading">Calibration</h3>

          <div className="chip-row">
            {([
              ["beep1k", "1kHz Beep"],
              ["beep200", "200Hz Low Beep"],
              ["beep2k", "Mixed (2kHz Sine)"],
              ["beep5k", "5kHz Beep"],
              ["impulse", "Click (Impulse)"]
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`chip-btn ${calibrationMode[key] ? "is-on" : ""}`.trim()}
                onClick={() => setCalibrationMode((prev) => ({ ...prev, [key]: !prev[key] }))}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="range-line" style={{ marginTop: 12 }}>
            <span className="field-label">Repeats</span>
            <input
              className="skin-range"
              type="range"
              min={1}
              max={20}
              step={1}
              value={calibrationRepeats}
              onChange={(event) => setCalibrationRepeats(Math.round(toNumber(event.target.value, 5)))}
            />
            <span>{calibrationRepeats}</span>
          </div>

          <div className="field-grid-2" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="skin-btn secondary"
              disabled={running}
              onClick={() => {
                const selected = (Object.entries(calibrationMode) as Array<
                  ["beep200" | "beep1k" | "beep2k" | "beep5k" | "impulse", boolean]
                >)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => key);
                onCalibrateSelected(selected, calibrationRepeats);
              }}
            >
              Calibrate Selected Presets
            </button>
            <button
              type="button"
              className="skin-btn secondary"
              disabled={running}
              onClick={() => onCalibrateAll(calibrationRepeats)}
            >
              Calibrate ALL Presets
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <p className="field-label">Calibration Offsets</p>
            <div className="scroll-box">
              <pre className="mono-pre">{calibrationText}</pre>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}

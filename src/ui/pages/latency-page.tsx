import { useMemo, useState } from "react";
import { LatencyProgress, LatencyReport, LatencyRequest, fmtMs, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type LatencyPageProps = {
  request: LatencyRequest;
  onChangeRequest: (request: LatencyRequest) => void;
  progressRows: LatencyProgress[];
  report: LatencyReport | null;
  running: boolean;
  progressPercent: number;
  onRun: () => void;
};

export function LatencyPage({
  request,
  onChangeRequest,
  progressRows,
  report,
  running,
  progressPercent,
  onRun
}: LatencyPageProps) {
  const [savePerSoundPlot, setSavePerSoundPlot] = useState(true);
  const [saveOverallBar, setSaveOverallBar] = useState(true);
  const [outputFolder, setOutputFolder] = useState("");
  const [calibrationRepeats, setCalibrationRepeats] = useState(5);
  const [calibrationMode, setCalibrationMode] = useState({
    beep200: true,
    beep1k: true,
    beep2k: true,
    beep5k: true,
    impulse: true
  });

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
    { key: "beep200", label: "200 Hz Beep", signal: "sine" as const, frequencyHz: 200 },
    { key: "beep1k", label: "1 kHz Beep", signal: "sine" as const, frequencyHz: 1000 },
    { key: "beep2k", label: "2 kHz Beep", signal: "sine" as const, frequencyHz: 2000 },
    { key: "beep5k", label: "5 kHz Beep", signal: "sine" as const, frequencyHz: 5000 },
    { key: "impulse", label: "Click (Impulse)", signal: "impulse" as const, frequencyHz: request.frequencyHz }
  ];

  function applyPreset(preset: (typeof presetOptions)[number]) {
    onChangeRequest({
      ...request,
      signal: preset.signal,
      frequencyHz: preset.frequencyHz
    });
  }

  function isPresetOn(preset: (typeof presetOptions)[number]) {
    if (preset.signal === "impulse") {
      return request.signal === "impulse";
    }
    return request.signal === "sine" && Math.abs(request.frequencyHz - preset.frequencyHz) < 0.1;
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
                className={`chip-btn ${isPresetOn(preset) ? "is-on" : ""}`.trim()}
                onClick={() => applyPreset(preset)}
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
                checked={savePerSoundPlot}
                onChange={(event) => setSavePerSoundPlot(event.target.checked)}
              />
              Save per-sound plot
            </label>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={saveOverallBar}
                onChange={(event) => setSaveOverallBar(event.target.checked)}
              />
              Save overall bar chart
            </label>
          </div>

          <div className="field-grid-4" style={{ marginTop: 12 }}>
            <label className="field-row" style={{ gridColumn: "span 3" }}>
              <span className="field-label">Output Folder</span>
              <input
                className="skin-input"
                value={outputFolder}
                placeholder="Select output folder"
                onChange={(event) => setOutputFolder(event.target.value)}
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
              <button type="button" className="skin-btn" disabled={running} onClick={onRun}>
                Run Selected
              </button>
              <button type="button" className="skin-btn secondary" disabled={running} onClick={onRun}>
                Run ALL
              </button>
            </div>
            <button type="button" className="skin-btn secondary" disabled>
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
              ["beep1k", "1 kHz Beep"],
              ["beep200", "200 Hz Beep"],
              ["beep2k", "2 kHz Beep"],
              ["beep5k", "5 kHz Beep"],
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

          <div className="field-grid-3" style={{ marginTop: 12 }}>
            <button type="button" className="skin-btn secondary" disabled>
              Calibrate Selected Presets
            </button>
            <button type="button" className="skin-btn secondary" disabled>
              Calibrate ALL Presets
            </button>
            <button type="button" className="skin-btn secondary" disabled>
              Calibrate GLOBAL (Impulse)
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <p className="field-label">Calibration Offsets</p>
            <div className="scroll-box">
              <pre className="mono-pre">
                {"Per-sound baselines (ms):\n"}
                {"- 1 kHz Beep: 0.00\n"}
                {"- 2 kHz Beep: 0.00\n"}
                {"- 5 kHz Beep: 0.00\n"}
                {"- 200 Hz Beep: 0.00\n"}
                {"- Click (Impulse): 0.00\n\n"}
                {"GLOBAL offset: 0.00 ms\n"}
                {"\nCalibration controls are visual placeholders in the current Tauri build."}
              </pre>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}

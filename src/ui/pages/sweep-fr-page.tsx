import { useState } from "react";
import { SweepRequest, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type SweepFrPageProps = {
  request: SweepRequest;
  onChangeRequest: (request: SweepRequest) => void;
  running: boolean;
  onRun: () => void;
};

export function SweepFrPage({ request, onChangeRequest, running, onRun }: SweepFrPageProps) {
  const [savePlots, setSavePlots] = useState(true);
  const [saveSquiglink, setSaveSquiglink] = useState(true);
  const [monoMode, setMonoMode] = useState(false);
  const [outputFolder, setOutputFolder] = useState("");

  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Sweep Frequency Response</h2>

        <section className="page-card">
          <h3 className="section-subheading">Sweep Settings</h3>

          <div className="field-grid-4">
            <LabeledNumberInput
              label="Start Freq (Hz)"
              value={request.f0}
              onChange={(event) => onChangeRequest({ ...request, f0: toNumber(event.target.value, 20) })}
            />
            <LabeledNumberInput
              label="End Freq (Hz)"
              value={request.f1}
              onChange={(event) =>
                onChangeRequest({ ...request, f1: toNumber(event.target.value, 20000) })
              }
            />
            <LabeledNumberInput
              label="Duration (s)"
              value={request.durationSecs}
              step={0.1}
              onChange={(event) =>
                onChangeRequest({ ...request, durationSecs: toNumber(event.target.value, 6) })
              }
            />

            <div className="field-row">
              <span className="field-label">Repeats</span>
              <div className="range-line">
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
                      repeats: Math.max(1, Math.round(toNumber(event.target.value, 1)))
                    })
                  }
                />
                <span>{request.repeats}</span>
              </div>
            </div>
          </div>

          <div className="field-grid-2" style={{ marginTop: 12 }}>
            <LabeledNumberInput
              label="Amplitude"
              value={request.amplitude}
              step={0.05}
              min={0}
              max={1}
              onChange={(event) =>
                onChangeRequest({ ...request, amplitude: toNumber(event.target.value, 0.5) })
              }
            />
            <div className="field-row">
              <span className="field-label">Options</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={savePlots}
                    onChange={(event) => setSavePlots(event.target.checked)}
                  />
                  Save plots
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={saveSquiglink}
                    onChange={(event) => setSaveSquiglink(event.target.checked)}
                  />
                  Save Squiglink format (.txt)
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={monoMode}
                    onChange={(event) => setMonoMode(event.target.checked)}
                  />
                  Mono Test (one side at a time)
                </label>
              </div>
            </div>
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
              <button type="button" className="skin-btn" disabled={running} onClick={onRun}>
                Run Sweep
              </button>
            </div>
          </div>
        </section>

        <div className="field-grid-2" style={{ marginTop: 12 }}>
          <section className="page-card">
            <h3 className="section-subheading">Input Level Monitor</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Ready to measure...
            </p>
            <div className="placeholder-box" style={{ minHeight: 82, marginBottom: 12 }} />
            <div className="field-grid-3">
              <div className="field-row">
                <span className="field-label">Current Level</span>
                <strong>-96.0 dBFS</strong>
              </div>
              <div className="field-row">
                <span className="field-label">Peak Level</span>
                <strong>-96.0 dBFS</strong>
              </div>
              <div className="field-row">
                <span className="field-label">SPL Estimate</span>
                <strong>-2.0 dB SPL</strong>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="skin-btn secondary" disabled>
                Start Monitoring
              </button>
              <button type="button" className="skin-btn secondary" disabled>
                Play Pink Noise
              </button>
              <button type="button" className="skin-btn secondary" disabled>
                Reset Peak
              </button>
            </div>
          </section>

          <section className="page-card">
            <h3 className="section-subheading">Sweep FR Results</h3>
            <div className="placeholder-box" style={{ minHeight: 468 }} />
            <div className="row-end" style={{ marginTop: 12 }}>
              <button type="button" className="skin-btn secondary" disabled>
                Export LAST (JSON)
              </button>
              <button type="button" className="skin-btn secondary" disabled>
                Export ALL (JSON)
              </button>
              <button type="button" className="skin-btn secondary" disabled>
                Export LAST to Squiglink
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { SweepRequest, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type SweepFrPageProps = {
  request: SweepRequest;
  onChangeRequest: (request: SweepRequest) => void;
  running: boolean;
  onRun: () => void;
  onBrowseOutputFolder: () => void;
  lastResult: {
    test: string;
    timestamp: string;
    params: Record<string, unknown>;
    metrics: Record<string, unknown>;
    data: Record<string, unknown>;
    files: Record<string, unknown>;
  } | null;
  monitor: {
    monitoring: boolean;
    status: string;
    currentDbfs: number;
    peakDbfs: number;
    clipCount: number;
    splEstimate: number;
    roughFrHz: number[];
    roughFrDb: number[];
  };
  pinkNoisePlaying: boolean;
  onStartMonitor: () => void;
  onStopMonitor: () => void;
  onStartPinkNoise: () => void;
  onStopPinkNoise: () => void;
  onResetPeak: () => void;
  hasSweepResult: boolean;
  hasSweepHistory: boolean;
  onExportLastJson: () => void;
  onExportAllJson: () => void;
  onExportLastSquiglink: () => void;
};

export function SweepFrPage({
  request,
  onChangeRequest,
  running,
  onRun,
  onBrowseOutputFolder,
  lastResult,
  monitor,
  pinkNoisePlaying,
  onStartMonitor,
  onStopMonitor,
  onStartPinkNoise,
  onStopPinkNoise,
  onResetPeak,
  hasSweepResult,
  hasSweepHistory,
  onExportLastJson,
  onExportAllJson,
  onExportLastSquiglink
}: SweepFrPageProps) {
  const [meterHistory, setMeterHistory] = useState<number[]>(() =>
    Array.from({ length: 48 }, () => 0)
  );

  const currentNorm = Math.min(1, Math.max(0, (monitor.currentDbfs + 96) / 96));
  const peakNorm = Math.min(1, Math.max(0, (monitor.peakDbfs + 96) / 96));
  const roughFrPath = (() => {
    const freqs = monitor.roughFrHz;
    const values = monitor.roughFrDb;
    if (freqs.length < 2 || values.length < 2 || freqs.length !== values.length) {
      return null;
    }
    const minHz = Math.max(1, freqs[0]);
    const maxHz = Math.max(minHz + 1, freqs[freqs.length - 1]);
    const minLog = Math.log10(minHz);
    const maxLog = Math.log10(maxHz);
    const spanLog = Math.max(1e-6, maxLog - minLog);

    return values
      .map((value, index) => {
        const hz = Math.min(maxHz, Math.max(minHz, freqs[index]));
        const x = ((Math.log10(hz) - minLog) / spanLog) * 100;
        const clamped = Math.max(-18, Math.min(18, value));
        const y = ((18 - clamped) / 36) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  })();

  useEffect(() => {
    setMeterHistory((prev) => [...prev.slice(1), currentNorm]);
  }, [currentNorm]);

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
                    checked={request.savePlots}
                    onChange={(event) =>
                      onChangeRequest({ ...request, savePlots: event.target.checked })
                    }
                  />
                  Save plots
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={request.saveSquiglink}
                    onChange={(event) =>
                      onChangeRequest({ ...request, saveSquiglink: event.target.checked })
                    }
                  />
                  Save Squiglink format (.txt)
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={request.monoMode}
                    onChange={(event) =>
                      onChangeRequest({ ...request, monoMode: event.target.checked })
                    }
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
                value={request.outputDir}
                placeholder="Select output folder"
                onChange={(event) => onChangeRequest({ ...request, outputDir: event.target.value })}
              />
            </label>
            <div className="row-end" style={{ alignItems: "end" }}>
              <button type="button" className="skin-btn secondary" onClick={onBrowseOutputFolder}>
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
              {monitor.status}
            </p>
            <div className="field-grid-2" style={{ marginBottom: 12 }}>
              <div>
                <div className="level-meter" style={{ marginBottom: 12 }}>
                  <div className="level-meter-grid" />
                  <div className="level-meter-bars">
                    {meterHistory.map((level, index) => (
                      <span
                        key={`meter-${index}`}
                        className={`level-meter-bar ${
                          level > 0.92 ? "is-hot" : level > 0.72 ? "is-warm" : ""
                        }`.trim()}
                        style={{
                          height: `${Math.max(8, level * 100)}%`
                        }}
                      />
                    ))}
                  </div>
                  <span className="level-meter-peak" style={{ left: `${peakNorm * 100}%` }} />
                </div>
                <div className="field-grid-3">
                  <div className="field-row">
                    <span className="field-label">Current Level</span>
                    <strong>{monitor.currentDbfs.toFixed(1)} dBFS</strong>
                  </div>
                  <div className="field-row">
                    <span className="field-label">Peak Level</span>
                    <strong>{monitor.peakDbfs.toFixed(1)} dBFS</strong>
                  </div>
                  <div className="field-row">
                    <span className="field-label">SPL Estimate</span>
                    <strong>{monitor.splEstimate.toFixed(1)} dB SPL</strong>
                  </div>
                </div>
              </div>
              <div className="level-meter">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8
                  }}
                >
                  <span className="field-label">Live Rough FR (Pink Noise)</span>
                  <span className="muted">{pinkNoisePlaying ? "Live" : "Idle"}</span>
                </div>
                <svg viewBox="0 0 100 100" style={{ width: "100%", height: 100, display: "block" }}>
                  <line x1="0" y1="50" x2="100" y2="50" stroke="var(--level-grid)" strokeWidth="1" />
                  <line x1="0" y1="25" x2="100" y2="25" stroke="var(--level-grid)" strokeWidth="0.6" />
                  <line x1="0" y1="75" x2="100" y2="75" stroke="var(--level-grid)" strokeWidth="0.6" />
                  {pinkNoisePlaying && roughFrPath ? (
                    <polyline
                      points={roughFrPath}
                      fill="none"
                      stroke="var(--accent-strong)"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : (
                    <text x="50" y="54" textAnchor="middle" fontSize="7" fill="var(--text-muted)">
                      Start Pink Noise + Monitoring
                    </text>
                  )}
                </svg>
              </div>
            </div>
            {monitor.clipCount > 0 && (
              <p className="muted" style={{ color: "#ff8e8e", marginTop: 8 }}>
                Clipping detected ({monitor.clipCount})
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={monitor.monitoring ? onStopMonitor : onStartMonitor}
              >
                {monitor.monitoring ? "Stop Monitoring" : "Start Monitoring"}
              </button>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={running}
                onClick={pinkNoisePlaying ? onStopPinkNoise : onStartPinkNoise}
              >
                {pinkNoisePlaying ? "Stop Pink Noise" : "Play Pink Noise"}
              </button>
              <button type="button" className="skin-btn secondary" onClick={onResetPeak}>
                Reset Peak
              </button>
            </div>
          </section>

          <section className="page-card">
            <h3 className="section-subheading">Sweep FR Results</h3>
            <div className="scroll-box" style={{ minHeight: 468, maxHeight: 468 }}>
              <pre className="mono-pre">
                {lastResult
                  ? JSON.stringify(lastResult, null, 2)
                  : "No sweep result yet. Run Sweep to populate this panel."}
              </pre>
            </div>
            <div className="row-end" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={running || !hasSweepResult}
                onClick={onExportLastJson}
              >
                Export LAST (JSON)
              </button>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={running || !hasSweepHistory}
                onClick={onExportAllJson}
              >
                Export ALL (JSON)
              </button>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={running || !hasSweepResult}
                onClick={onExportLastSquiglink}
              >
                Export LAST to Squiglink
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

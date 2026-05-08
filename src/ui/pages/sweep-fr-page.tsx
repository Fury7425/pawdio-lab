import { useEffect, useState } from "react";
import { AudioWaveform } from "lucide-react";
import { toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { DropdownMenu } from "../components/dropdown-menu";
import { usePawdioLabContext } from "../pawdio-context";

export function SweepFrPage() {
  const ctx = usePawdioLabContext();
  const request = ctx.sweepRequest;
  const onChangeRequest = ctx.setSweepRequest;
  const running = ctx.running;
  const onRun = () => ctx.run(ctx.runSweepFrTest());
  const onBrowseOutputFolder = () => ctx.run(ctx.browseSweepOutputFolder());
  const lastResult = ctx.sweepLastResult;
  const monitor = ctx.inputMonitor;
  const pinkNoisePlaying = ctx.pinkNoisePlaying;
  const monoConfirmMessage = ctx.monoConfirmState?.message ?? null;
  const onMonoConfirmOk = ctx.confirmMonoDialog;
  const onMonoConfirmCancel = ctx.cancelMonoDialog;
  const onStartMonitor = () => ctx.run(ctx.startInputMonitor());
  const onStopMonitor = () => ctx.run(ctx.stopInputMonitor());
  const onStartPinkNoise = () => ctx.run(ctx.startPinkNoise());
  const onStopPinkNoise = () => ctx.run(ctx.stopPinkNoise());
  const onResetPeak = () => ctx.run(ctx.resetInputMonitorPeak());
  const hasSweepResult = ctx.sweepLastResult !== null;
  const hasSweepHistory = ctx.results.some(
    (entry) => entry.payload.test === "sweep_fr",
  );
  const onExportLastJson = () => ctx.run(ctx.exportSweepLastJson());
  const onExportAllJson = () => ctx.run(ctx.exportSweepAllJson());
  const onExportLastSquiglink = () => ctx.run(ctx.exportSweepLastSquiglink());
  const onExportLastCsv = () => ctx.run(ctx.exportSweepLastCsv());
  const [meterHistory, setMeterHistory] = useState<number[]>(() =>
    Array.from({ length: 48 }, () => 0),
  );

  const currentNorm = Math.min(1, Math.max(0, (monitor.currentDbfs + 96) / 96));
  const peakNorm = Math.min(1, Math.max(0, (monitor.peakDbfs + 96) / 96));
  const roughFrGraph = (() => {
    const freqs = monitor.roughFrHz;
    const values = monitor.roughFrDb;
    if (
      freqs.length < 2 ||
      values.length < 2 ||
      freqs.length !== values.length
    ) {
      return null;
    }
    const minHz = 20;
    const maxHz = 20000;
    const minLog = Math.log10(minHz);
    const maxLog = Math.log10(maxHz);
    const spanLog = Math.max(1e-6, maxLog - minLog);

    const smoothValues = values.map((_, index) => {
      let weightedSum = 0;
      let weightTotal = 0;
      for (let offset = -1; offset <= 1; offset += 1) {
        const target = index + offset;
        if (target < 0 || target >= values.length) {
          continue;
        }
        const weight = offset === 0 ? 2 : 1;
        weightedSum += values[target] * weight;
        weightTotal += weight;
      }
      return weightTotal > 0 ? weightedSum / weightTotal : values[index];
    });

    const points = smoothValues.map((value, index) => {
      const hz = Math.min(maxHz, Math.max(minHz, freqs[index]));
      const x = ((Math.log10(hz) - minLog) / spanLog) * 200;
      const clamped = Math.max(-20, Math.min(20, value));
      const y = 10 + ((20 - clamped) / 40) * 80;
      return { x, y };
    });

    if (points.length < 2) {
      return null;
    }

    let linePath = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      linePath += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
    }
    const last = points[points.length - 1];
    linePath += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;

    const xGuides = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
      .map((freq) => {
        const x = ((Math.log10(freq) - minLog) / spanLog) * 200;
        if (!Number.isFinite(x) || x < 0 || x > 200) {
          return null;
        }
        const label = freq >= 1000 ? `${Math.round(freq / 1000)}k` : `${freq}`;
        return { x, label };
      })
      .filter((entry): entry is { x: number; label: string } => entry !== null);

    return {
      linePath,
      areaPath: `${linePath} L 200 100 L 0 100 Z`,
      xGuides,
    };
  })();

  useEffect(() => {
    setMeterHistory((prev) => [...prev.slice(1), currentNorm]);
  }, [currentNorm]);

  return (
    <div className="page-stack">
      {monoConfirmMessage && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p className="modal-message">{monoConfirmMessage}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="skin-btn secondary"
                onClick={onMonoConfirmCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="skin-btn"
                onClick={onMonoConfirmOk}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="page-card">
        <h2 className="section-heading">Sweep Frequency Response</h2>

        <section className="page-section">
          <h3 className="section-subheading">Sweep Settings</h3>

          <div className="field-grid-4">
            <LabeledNumberInput
              label="Start Freq (Hz)"
              value={request.f0}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  f0: toNumber(event.target.value, 20),
                })
              }
            />
            <LabeledNumberInput
              label="End Freq (Hz)"
              value={request.f1}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  f1: toNumber(event.target.value, 20000),
                })
              }
            />
            <LabeledNumberInput
              label="Duration (s)"
              value={request.durationSecs}
              step={0.1}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  durationSecs: toNumber(event.target.value, 6),
                })
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
                      repeats: Math.max(
                        1,
                        Math.round(toNumber(event.target.value, 1)),
                      ),
                    })
                  }
                />
                <span>{request.repeats}</span>
              </div>
            </div>
          </div>

          <div className="field-grid-2 mt-12">
            <LabeledNumberInput
              label="Amplitude"
              value={request.amplitude}
              step={0.05}
              min={0}
              max={1}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  amplitude: toNumber(event.target.value, 0.5),
                })
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
                      onChangeRequest({
                        ...request,
                        savePlots: event.target.checked,
                      })
                    }
                  />
                  Save plots
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={request.saveSquiglink}
                    onChange={(event) =>
                      onChangeRequest({
                        ...request,
                        saveSquiglink: event.target.checked,
                      })
                    }
                  />
                  Save Squiglink format (.txt)
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={request.monoMode}
                    onChange={(event) =>
                      onChangeRequest({
                        ...request,
                        monoMode: event.target.checked,
                      })
                    }
                  />
                  Mono Test (one side at a time)
                </label>
              </div>
            </div>
          </div>

          <div className="field-grid-4 mt-12">
            <label className="field-row" style={{ gridColumn: "span 3" }}>
              <span className="field-label">Output Folder</span>
              <input
                className="skin-input"
                value={request.outputDir}
                placeholder="Select output folder"
                onChange={(event) =>
                  onChangeRequest({ ...request, outputDir: event.target.value })
                }
              />
            </label>
            <div className="row-end" style={{ alignItems: "end" }}>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={onBrowseOutputFolder}
              >
                Browse
              </button>
              <button
                type="button"
                className="skin-btn"
                disabled={running}
                onClick={onRun}
              >
                Run Sweep
              </button>
            </div>
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <div className="field-grid-2">
            <section className="page-card">
              <h3 className="section-subheading">Input Level Monitor</h3>
              <p className="muted">{monitor.status}</p>
              <div className="level-meter mb-12">
                <div className="level-meter-grid" />
                <div className="level-meter-bars">
                  {meterHistory.map((level, index) => (
                    <span
                      key={`meter-${index}`}
                      className={`level-meter-bar ${
                        level > 0.92 ? "is-hot" : level > 0.72 ? "is-warm" : ""
                      }`.trim()}
                      style={{
                        height: `${Math.max(8, level * 100)}%`,
                      }}
                    />
                  ))}
                </div>
                <span
                  className="level-meter-peak"
                  style={{ left: `${peakNorm * 100}%` }}
                />
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
              {monitor.clipCount > 0 && (
                <p className="muted mt-8" style={{ color: "#ff8e8e" }}>
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
                <button
                  type="button"
                  className="skin-btn secondary"
                  onClick={onResetPeak}
                >
                  Reset Peak
                </button>
              </div>
            </section>

            <section className="page-card live-rough-card">
              <h3 className="section-subheading">Live Rough FR (Pink Noise)</h3>
              <p className="muted">
                {pinkNoisePlaying
                  ? "Live preview running"
                  : "Start Pink Noise + Monitoring"}
              </p>
              <div className="level-meter live-rough-meter">
                <svg viewBox="0 0 200 100" className="live-rough-svg">
                  <line
                    x1="0"
                    y1="10"
                    x2="200"
                    y2="10"
                    stroke="var(--level-grid)"
                    strokeWidth="0.6"
                  />
                  <line
                    x1="0"
                    y1="50"
                    x2="200"
                    y2="50"
                    stroke="var(--level-grid)"
                    strokeWidth="1"
                  />
                  <line
                    x1="0"
                    y1="90"
                    x2="200"
                    y2="90"
                    stroke="var(--level-grid)"
                    strokeWidth="0.6"
                  />
                  {(roughFrGraph?.xGuides ?? []).map((guide) => (
                    <g key={`guide-${guide.label}-${guide.x.toFixed(2)}`}>
                      <line
                        x1={guide.x}
                        y1="8"
                        x2={guide.x}
                        y2="92"
                        stroke="var(--level-grid)"
                        strokeWidth="0.45"
                      />
                      <text
                        x={guide.x}
                        y="98"
                        textAnchor="middle"
                        fontSize="7"
                        fill="var(--text-muted)"
                      >
                        {guide.label}
                      </text>
                    </g>
                  ))}
                  <text x="4" y="12" fontSize="7" fill="var(--text-muted)">
                    +18 dB
                  </text>
                  <text x="4" y="52" fontSize="7" fill="var(--text-muted)">
                    0 dB
                  </text>
                  <text x="4" y="92" fontSize="7" fill="var(--text-muted)">
                    -18 dB
                  </text>
                  {pinkNoisePlaying && roughFrGraph ? (
                    <>
                      <path
                        d={roughFrGraph.areaPath}
                        fill="var(--accent-dim)"
                        opacity="0.2"
                      />
                      <path
                        d={roughFrGraph.linePath}
                        fill="none"
                        stroke="var(--accent-strong)"
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </>
                  ) : (
                    <text
                      x="100"
                      y="54"
                      textAnchor="middle"
                      fontSize="8"
                      fill="var(--text-muted)"
                    >
                      Waiting for live data
                    </text>
                  )}
                </svg>
              </div>
            </section>
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Sweep FR Results</h3>
          <div
            className="scroll-box"
            style={{ minHeight: 468, maxHeight: 468 }}
          >
            {lastResult ? (
              <div>
                <div className="result-header">
                  <h4>{lastResult.test}</h4>
                  <time>{lastResult.timestamp}</time>
                </div>

                {lastResult.metrics &&
                  Object.keys(lastResult.metrics).length > 0 && (
                    <>
                      <p className="section-subheading" style={{ marginTop: 12 }}>
                        Metrics
                      </p>
                      <div className="metric-grid">
                        {Object.entries(lastResult.metrics).map(
                          ([key, value]) => (
                            <article key={key} className="metric-card">
                              <p className="metric-label">{key}</p>
                              <p className="metric-value" style={{ fontSize: 16 }}>
                                {typeof value === "number"
                                  ? value.toFixed(2)
                                  : String(value)}
                              </p>
                            </article>
                          ),
                        )}
                      </div>
                    </>
                  )}

                {lastResult.params &&
                  Object.keys(lastResult.params).length > 0 && (
                    <>
                      <p
                        className="section-subheading"
                        style={{ marginTop: 14 }}
                      >
                        Parameters
                      </p>
                      <dl className="kv-grid">
                        {Object.entries(lastResult.params).map(
                          ([key, value]) => (
                            <span key={key} style={{ display: "contents" }}>
                              <dt>{key}</dt>
                              <dd>{String(value)}</dd>
                            </span>
                          ),
                        )}
                      </dl>
                    </>
                  )}

                <details className="raw-json-details">
                  <summary>Raw JSON</summary>
                  <pre className="mono-pre" style={{ marginTop: 8 }}>
                    {JSON.stringify(lastResult, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: 400 }}>
                <AudioWaveform size={32} />
                <span>Run a sweep to see results here</span>
              </div>
            )}
          </div>
          <div className="row-end mt-12">
            <DropdownMenu
              label="Export"
              disabled={running || (!hasSweepResult && !hasSweepHistory)}
            >
              <button
                type="button"
                className="dropdown-item"
                disabled={running || !hasSweepResult}
                onClick={onExportLastJson}
              >
                Export LAST (JSON)
              </button>
              <button
                type="button"
                className="dropdown-item"
                disabled={running || !hasSweepHistory}
                onClick={onExportAllJson}
              >
                Export ALL (JSON)
              </button>
              <button
                type="button"
                className="dropdown-item"
                disabled={running || !hasSweepResult}
                onClick={onExportLastSquiglink}
              >
                Export LAST to Squiglink
              </button>
              <button
                type="button"
                className="dropdown-item"
                disabled={running || !hasSweepResult}
                onClick={onExportLastCsv}
              >
                Export LAST (CSV)
              </button>
            </DropdownMenu>
          </div>
        </section>
      </section>
    </div>
  );
}

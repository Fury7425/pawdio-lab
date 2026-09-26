import { useEffect, useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import {
  CAPTURE_ORDER_META,
  DEFAULT_OUTPUT_LABEL,
  toNumber,
  type CaptureOrder,
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { ExportMenu } from "../components/export-menu";
import { CheckboxField } from "../components/form-fields";
import { Modal } from "../components/modal";
import { PageHeader } from "../components/page-header";
import { RunBar } from "../components/run-bar";
import { SweepResultView } from "../components/sweep-result-view";
import { CurveViewControls } from "../components/curve-view-controls";
import { useCurveView } from "../hooks/use-curve-view";
import { useActiveInputCalibration } from "../hooks/use-spl-calibration";
import { useShortcutBindings } from "../hooks/use-shortcuts";
import { dbfsToDbSpl } from "../lib/spl-calibration";
import { usePawdioLabContext } from "../pawdio-context";

const CAPTURE_ORDERS: CaptureOrder[] = ["stereo", "left_first", "right_first"];

const SIDE_LABEL = { stereo: "Stereo", left: "Left", right: "Right" } as const;

export function SweepFrPage() {
  const ctx = usePawdioLabContext();
  const { bindings } = useShortcutBindings();
  // Display processing for both the review modal and the result view, so a
  // sweep looks the same when it is judged as it does once it is kept.
  const curveView = useCurveView();
  // Real dB SPL once the input has been calibrated against a known source;
  // before that the meter says so instead of implying a level it cannot know.
  const calibration = useActiveInputCalibration();
  const request = ctx.sweepRequest;
  const onChangeRequest = ctx.setSweepRequest;
  const running = ctx.running;
  const busy = running || ctx.sweepSessionActive;
  const onRun = () => ctx.run(ctx.runSweepFrTest());
  const onBrowseOutputFolder = () => ctx.run(ctx.browseSweepOutputFolder());
  const lastResult = ctx.sweepLastResult;
  const monitor = ctx.inputMonitor;
  const pinkNoisePlaying = ctx.pinkNoisePlaying;
  const monoConfirmMessage = ctx.monoConfirmState?.message ?? null;
  const review = ctx.sweepReviewState;
  const sweepProgress = ctx.sweepRunProgress;
  const onMonoConfirmOk = ctx.confirmMonoDialog;
  const onMonoConfirmCancel = ctx.cancelMonoDialog;
  const onStartMonitor = () => ctx.run(ctx.startInputMonitor());
  const onStopMonitor = () => ctx.run(ctx.stopInputMonitor());
  const onStartPinkNoise = () => ctx.run(ctx.startPinkNoise());
  const onStopPinkNoise = () => ctx.run(ctx.stopPinkNoise());
  const onResetPeak = () => ctx.run(ctx.resetInputMonitorPeak());
  const hasSweepResult =
    ctx.sweepLastResult !== null && ctx.sweepLastResultStatus === "final";
  const hasSweepHistory = ctx.results.some(
    (entry) => entry.payload.test === "sweep_fr",
  );
  const onExportLastJson = () => ctx.run(ctx.exportSweepLastJson());
  const onExportAllJson = () => ctx.run(ctx.exportSweepAllJson());
  const onExportLastSquiglink = () => ctx.run(ctx.exportSweepLastSquiglink());
  const onExportLastCsv = () => ctx.run(ctx.exportSweepLastCsv());
  const captureOrder = request.captureOrder ?? "stereo";
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

  const reviewKeys =
    bindings.accept_review && bindings.reject_review
      ? ` (${bindings.accept_review} accept, ${bindings.reject_review} discard)`
      : "";
  const sweepStatus = !sweepProgress ? (
    `Ready · ${request.repeats} accepted ${request.repeats === 1 ? "sweep" : "sweeps"}, ${CAPTURE_ORDER_META[captureOrder].label.toLowerCase()} capture${ctx.settings.bluetoothMode ? ", wireless alignment on" : ""}`
  ) : sweepProgress.side === "complete" ? (
    "Sweep set complete"
  ) : (
    <>
      <strong className="run-bar-emph">{SIDE_LABEL[sweepProgress.side]}</strong>
      {sweepProgress.phase === "reviewing"
        ? ` · waiting for approval${reviewKeys}`
        : " · capturing"}
    </>
  );
  const sweepPercent = sweepProgress
    ? (sweepProgress.accepted / Math.max(1, sweepProgress.target)) * 100
    : null;
  const sweepDetail = sweepProgress
    ? `${sweepProgress.accepted} of ${sweepProgress.target} accepted · ${sweepProgress.attempts} ${sweepProgress.attempts === 1 ? "attempt" : "attempts"}`
    : undefined;

  return (
    <div className="page-stack">
      <Modal
        open={Boolean(monoConfirmMessage)}
        onClose={onMonoConfirmCancel}
        footer={
          <>
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
          </>
        }
      >
        <p className="modal-message">{monoConfirmMessage}</p>
      </Modal>

      <Modal
        open={Boolean(review)}
        onClose={ctx.rejectSweepReview}
        title="Accept this sweep?"
        className="sweep-review-modal"
        footer={
          <>
            <button
              type="button"
              className="skin-btn secondary"
              onClick={ctx.rejectSweepReview}
            >
              No, discard
            </button>
            <button
              type="button"
              className="skin-btn"
              onClick={ctx.acceptSweepReview}
            >
              Yes, accept
            </button>
          </>
        }
      >
        {review && (
          <>
            <p className="modal-message sweep-review-copy">
              {review.side === "stereo"
                ? "Stereo"
                : review.side === "left"
                  ? "Left"
                  : "Right"}{" "}
              attempt {review.attempt} is ready. Accepting it will advance the
              valid count from {review.accepted} to {review.accepted + 1} of{" "}
              {review.target}; discarding it leaves the count unchanged.
            </p>
            <SweepResultView
              result={review.payload}
              status="pending"
              compact
              curveView={curveView}
            />
          </>
        )}
      </Modal>

      <section className="page-card">
        <PageHeader
          title="Sweep Frequency Response"
          description="Check the input level first, then capture log-chirp sweeps."
        />

        <div className="field-grid-2">
          <section className="page-card">
            <div className="inset-panel-head">
              <h3 className="section-subheading">1 · Input level</h3>
              <span className="muted compact-note">{monitor.status}</span>
            </div>
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
                <span className="field-label">Current</span>
                <strong>{monitor.currentDbfs.toFixed(1)} dBFS</strong>
              </div>
              <div className="field-row">
                <span className="field-label">Peak</span>
                <strong>{monitor.peakDbfs.toFixed(1)} dBFS</strong>
              </div>
              <div className="field-row">
                <span className="field-label">Sound level</span>
                {calibration.sensitivity !== null ? (
                  <strong>
                    {(
                      dbfsToDbSpl(
                        monitor.currentDbfs,
                        calibration.sensitivity,
                      ) ?? 0
                    ).toFixed(1)}{" "}
                    dB SPL
                  </strong>
                ) : (
                  <span className="muted" title="Calibrate on the Devices page">
                    - <span className="compact-note">(not calibrated)</span>
                  </span>
                )}
              </div>
            </div>
            {monitor.clipCount > 0 && (
              <p className="field-error mt-8">
                Clipping detected ({monitor.clipCount})
              </p>
            )}
            <div className="btn-row mt-12">
              <button
                type="button"
                className="skin-btn secondary"
                disabled={ctx.sweepSessionActive}
                onClick={monitor.monitoring ? onStopMonitor : onStartMonitor}
              >
                {monitor.monitoring ? "Stop Monitoring" : "Start Monitoring"}
              </button>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={busy}
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
            <div className="inset-panel-head">
              <h3 className="section-subheading">2 · Live rough FR</h3>
              <span className="muted compact-note">
                {pinkNoisePlaying
                  ? "Live preview running"
                  : "Needs pink noise and monitoring"}
              </span>
            </div>
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
                  +20 dB
                </text>
                <text x="4" y="52" fontSize="7" fill="var(--text-muted)">
                  0 dB
                </text>
                <text x="4" y="92" fontSize="7" fill="var(--text-muted)">
                  -20 dB
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
                    Play pink noise to preview the fit
                  </text>
                )}
              </svg>
            </div>
          </section>
        </div>

        <h3 className="section-subheading mt-20">3 · Sweep settings</h3>
        <div className="sweep-settings-grid">
          <LabeledNumberInput
            label="Start (Hz)"
            value={request.f0}
            onChange={(event) =>
              onChangeRequest({
                ...request,
                f0: toNumber(event.target.value, 20),
              })
            }
          />
          <LabeledNumberInput
            label="End (Hz)"
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
          <LabeledNumberInput
            label="Accepted sweeps"
            value={request.repeats}
            min={1}
            max={20}
            step={1}
            onChange={(event) =>
              onChangeRequest({
                ...request,
                repeats: Math.min(
                  20,
                  Math.max(1, Math.round(toNumber(event.target.value, 1))),
                ),
              })
            }
          />
          <div className="field-row">
            <span className="field-label">Capture</span>
            <div className="segmented" role="group" aria-label="Capture order">
              {CAPTURE_ORDERS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`segmented-btn${captureOrder === opt ? " is-active" : ""}`}
                  aria-pressed={captureOrder === opt}
                  title={CAPTURE_ORDER_META[opt].detail}
                  onClick={() =>
                    onChangeRequest({
                      ...request,
                      captureOrder: opt,
                      monoMode: opt !== "stereo",
                    })
                  }
                >
                  {CAPTURE_ORDER_META[opt].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="fold-list mt-12">
          <details className="fold">
            <summary>
              <ChevronRight
                size={14}
                className="fold-chevron"
                aria-hidden="true"
              />
              Output options
              <span className="fold-summary">
                {request.outputDir || DEFAULT_OUTPUT_LABEL} · plots{" "}
                {request.savePlots ? "on" : "off"} · Squiglink{" "}
                {request.saveSquiglink ? "on" : "off"}
              </span>
            </summary>
            <div className="fold-body">
              <div className="field-grid-2">
                <CheckboxField
                  label="Save plots"
                  checked={request.savePlots}
                  onChange={(checked) =>
                    onChangeRequest({ ...request, savePlots: checked })
                  }
                />
                <CheckboxField
                  label="Save Squiglink format (.txt)"
                  checked={request.saveSquiglink}
                  onChange={(checked) =>
                    onChangeRequest({ ...request, saveSquiglink: checked })
                  }
                />
              </div>
              <div className="field-grid-4 mt-12">
                <label className="field-row field-span-3">
                  <span className="field-label">Output Folder</span>
                  <input
                    className="skin-input"
                    value={request.outputDir}
                    placeholder={`Full path. Empty saves plots to ${DEFAULT_OUTPUT_LABEL}`}
                    onChange={(event) =>
                      onChangeRequest({
                        ...request,
                        outputDir: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="row-end align-end">
                  <button
                    type="button"
                    className="skin-btn secondary"
                    onClick={onBrowseOutputFolder}
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>

      <section className="page-card sweep-result-page">
        <div className="sweep-result-page-heading">
          <div>
            <h3 className="section-heading">Latest Sweep Result</h3>
            <p className="muted">
              Full-size review of the most recently captured sweep. During a
              run, this updates before the Accept or Discard decision.
            </p>
          </div>
          <div className="row-end">
            <ExportMenu
              disabled={busy || (!hasSweepResult && !hasSweepHistory)}
              items={[
                {
                  label: "Export Last (JSON)",
                  onSelect: onExportLastJson,
                  disabled: busy || !hasSweepResult,
                },
                {
                  label: "Export All (JSON)",
                  onSelect: onExportAllJson,
                  disabled: busy || !hasSweepHistory,
                },
                {
                  label: "Export Last to Squiglink",
                  onSelect: onExportLastSquiglink,
                  disabled: busy || !hasSweepResult,
                },
                {
                  label: "Export Last (CSV)",
                  onSelect: onExportLastCsv,
                  disabled: busy || !hasSweepResult,
                },
              ]}
            />
          </div>
        </div>

        <CurveViewControls controller={curveView} />

        <SweepResultView
          result={lastResult}
          status={ctx.sweepLastResultStatus}
          curveView={curveView}
        />

        {lastResult && (
          <details className="raw-json-details">
            <summary>Raw sweep data</summary>
            <pre className="mono-pre" style={{ marginTop: 8 }}>
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </details>
        )}
      </section>

      <RunBar
        actions={
          <button
            type="button"
            className={`skin-btn${busy ? " is-loading" : ""}`}
            disabled={busy}
            onClick={onRun}
          >
            <Play size={12} fill="currentColor" aria-hidden="true" />
            {sweepProgress && sweepProgress.phase !== "complete"
              ? "Sweep in Progress"
              : "Run Sweep"}
            {!busy && bindings.start_test && (
              <kbd className="btn-kbd">{bindings.start_test}</kbd>
            )}
          </button>
        }
        status={sweepStatus}
        detail={sweepDetail}
        progress={sweepPercent}
        stoppable={busy}
      />
    </div>
  );
}

import { useState } from "react";
import { EarOff, Check } from "lucide-react";
import {
  ANC_MODE_META,
  ANC_MODE_ORDERED,
  AncModeKey,
  AncSnapshot,
  toNumber,
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { usePawdioLabContext } from "../pawdio-context";

type Channel = "L" | "R";

const MIN_LOG = Math.log10(20);
const MAX_LOG = Math.log10(20000);
const SPAN_LOG = MAX_LOG - MIN_LOG;

function toX(hz: number): number {
  return ((Math.log10(Math.max(20, Math.min(20000, hz))) - MIN_LOG) / SPAN_LOG) * 200;
}

function buildCurvePath(
  freqs: number[],
  values: number[],
  toY: (db: number) => number,
): string {
  if (freqs.length < 2 || values.length < 2) return "";
  const points = freqs.map((hz, i) => ({ x: toX(hz), y: toY(values[i]) }));
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  path += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return path;
}

function fmtTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return timestamp.slice(11, 19);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return timestamp.slice(0, 8);
  }
}

function meanOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function AncPage() {
  const ctx = usePawdioLabContext();
  const request = ctx.ancRequest;
  const onChangeRequest = ctx.setAncRequest;
  const selectedModes = ctx.ancSelectedModes;
  const onChangeSelectedModes = ctx.setAncSelectedModes;
  const captures = ctx.ancCaptures;
  const running = ctx.running;
  const stepPrompt = ctx.ancStepPrompt;
  const currentStep = ctx.ancCurrentStep;
  const totalSteps = ctx.ancSelectedModes.length;
  const stepIndex =
    ctx.ancSelectedModes.length - ctx.ancRunQueue.length - 1;
  const onStart = ctx.startAncFlow;
  const onConfirmStep = () => ctx.run(ctx.confirmAncStep());
  const onCancelStep = ctx.cancelAncFlow;
  const onReset = ctx.resetAncCaptures;
  const onBrowseOutputFolder = () => ctx.run(ctx.browseAncOutputFolder());
  const onExportPlots = (
    baseline: AncSnapshot,
    modes: Array<{ key: AncModeKey; label: string; snapshot: AncSnapshot }>,
  ) => ctx.run(ctx.exportAncPlots(baseline, modes));
  const onExportSquiglink = (
    baseline: AncSnapshot,
    key: AncModeKey,
    label: string,
    snapshot: AncSnapshot,
  ) => ctx.run(ctx.exportAncSquiglink(baseline, key, label, snapshot));
  const modeMeta = ANC_MODE_META;
  const modeOrdered = ANC_MODE_ORDERED;
  const [visibleModes, setVisibleModes] = useState<Set<AncModeKey>>(
    new Set(["anc", "transparency"]),
  );
  const [channel, setChannel] = useState<Channel>("L");

  // Baseline = first captured mode in priority order
  const baseline: AncSnapshot | undefined = ANC_MODE_ORDERED.map(
    (m) => captures[m],
  ).find((c) => c !== undefined);

  const baselineKey: AncModeKey | undefined = ANC_MODE_ORDERED.find(
    (m) => captures[m] !== undefined,
  );

  // negative = ANC cancelling (active quieter than baseline)
  // positive = mode amplifies vs baseline (transparency overshoot, rare)
  function getAttenuation(snap: AncSnapshot): number[] {
    if (!baseline) return [];
    const bArr = channel === "L" ? baseline.magDbLeft : baseline.magDbRight;
    const aArr = channel === "L" ? snap.magDbLeft : snap.magDbRight;
    return aArr.map((a, i) => a - bArr[i]);
  }

  // Y-axis: +10 top (slight amplification), -40 bottom (strong cancellation)
  const nonBaselineCaptured = modeOrdered.filter(
    (m) => m !== baselineKey && captures[m] !== undefined,
  );
  const hasTransOnly =
    nonBaselineCaptured.length === 1 &&
    nonBaselineCaptured[0] === "transparency";
  const yMin = hasTransOnly ? -15 : -40;
  const yMax = hasTransOnly ? 15 : 10;
  const ySpan = yMax - yMin;

  function toY(db: number): number {
    const clamped = Math.max(yMin, Math.min(yMax, db));
    return 10 + ((yMax - clamped) / ySpan) * 80;
  }

  const zeroY = toY(0);

  const X_GUIDES = [100, 500, 1000, 5000, 10000];

  function toggleMode(key: AncModeKey) {
    onChangeSelectedModes(
      selectedModes.includes(key)
        ? selectedModes.filter((m) => m !== key)
        : [...selectedModes, key],
    );
  }

  function toggleVisible(key: AncModeKey) {
    setVisibleModes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hasAnyCapture = modeOrdered.some((m) => captures[m] !== undefined);

  const exportableModes = baseline && baselineKey
    ? modeOrdered.filter(
        (m) => m !== baselineKey && captures[m] !== undefined,
      )
    : [];

  const stepNum = stepIndex + 1;

  return (
    <div className="page-stack">
      {/* Step modal */}
      {stepPrompt && currentStep && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p className="modal-step-label">
              Step {stepNum} of {totalSteps}
            </p>
            <div
              className="modal-icon-circle"
              style={{ background: modeMeta[currentStep].color }}
            >
              <EarOff size={18} color="#fff" />
            </div>
            <h3 className="section-heading" style={{ marginBottom: 6 }}>
              {modeMeta[currentStep].captureTitle}
            </h3>
            <p className="muted" style={{ marginBottom: 16 }}>
              {modeMeta[currentStep].captureDetail}
            </p>
            {running && (
              <div
                className="modal-progress-track"
                role="progressbar"
                aria-label="Recording in progress"
              >
                <div className="modal-progress-pulse" />
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="skin-btn secondary"
                onClick={onCancelStep}
              >
                Cancel
              </button>
              <button
                type="button"
                className="skin-btn"
                disabled={running}
                onClick={onConfirmStep}
              >
                {running ? "Recording…" : "Start Recording"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config card */}
      <section className="page-card">
        <h2 className="section-heading">ANC / Transparency Measurement</h2>

        <section className="page-section">
          <h3 className="section-subheading">Select Modes</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            Choose which headphone states to capture. True Reference (no
            headphones) gives absolute attenuation values.
          </p>

          <div className="mode-grid">
            {modeOrdered.map((key) => {
              const meta = modeMeta[key];
              const selected = selectedModes.includes(key);
              const captured = captures[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`mode-select-btn${selected ? " is-on" : ""}`}
                  aria-pressed={selected}
                  onClick={() => toggleMode(key)}
                  style={{
                    borderColor: selected ? meta.color : undefined,
                    borderLeftColor: selected ? meta.color : undefined,
                    background: selected
                      ? `color-mix(in srgb, ${meta.color} 8%, transparent)`
                      : undefined,
                  }}
                >
                  {selected && (
                    <span className="mode-select-check" style={{ color: meta.color }}>
                      <Check size={12} />
                    </span>
                  )}
                  <div
                    className="mode-select-label"
                    style={{ color: selected ? meta.color : undefined }}
                  >
                    {meta.label}
                  </div>
                  <div className="mode-select-detail">{meta.detail}</div>
                  {captured && (
                    <div
                      className="mode-select-timestamp"
                      style={{ color: meta.color }}
                    >
                      ✓ {fmtTime(captured.timestamp)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="page-section">
          <h3 className="section-subheading">Sweep Settings</h3>
          <div className="field-grid-4">
            <LabeledNumberInput
              label="Duration (s)"
              value={request.durationSecs}
              step={0.5}
              onChange={(e) =>
                onChangeRequest({
                  ...request,
                  durationSecs: toNumber(e.target.value, 6),
                })
              }
            />
            <LabeledNumberInput
              label="Repeats"
              value={request.repeats}
              step={1}
              onChange={(e) =>
                onChangeRequest({
                  ...request,
                  repeats: Math.max(1, Math.round(toNumber(e.target.value, 1))),
                })
              }
            />
            <LabeledNumberInput
              label="Amplitude"
              value={request.amplitude}
              step={0.05}
              onChange={(e) =>
                onChangeRequest({
                  ...request,
                  amplitude: toNumber(e.target.value, 0.5),
                })
              }
            />
          </div>
        </section>

        {request.savePlots && (
          <section className="page-section">
            <h3 className="section-subheading">Output</h3>
            <div className="field-row">
              <input
                className="skin-input"
                type="text"
                readOnly
                placeholder="Select output folder…"
                value={request.outputDir}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="skin-btn secondary"
                onClick={onBrowseOutputFolder}
              >
                Browse
              </button>
            </div>
          </section>
        )}

        <div className="action-row">
          {hasAnyCapture && (
            <button
              type="button"
              className="skin-btn secondary"
              onClick={onReset}
              disabled={running}
            >
              Reset Captures
            </button>
          )}
          <button
            type="button"
            className="skin-btn"
            disabled={running || selectedModes.length === 0}
            onClick={onStart}
          >
            Start Measurement
          </button>
        </div>
      </section>

      {/* Results card */}
      {hasAnyCapture && (
        <section className="page-card">
          <h2 className="section-heading">Attenuation Results</h2>

          {/* Graph controls */}
          <div className="graph-controls-row">
            <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>
              Show:
            </span>
            {modeOrdered
              .filter((m) => captures[m] !== undefined && m !== baselineKey)
              .map((key) => {
                const meta = modeMeta[key];
                const active = visibleModes.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="chip-btn"
                    aria-pressed={active}
                    aria-label={`Show ${meta.label}`}
                    onClick={() => toggleVisible(key)}
                    style={{
                      borderColor: meta.color,
                      background: active ? meta.color : "transparent",
                      color: active ? "#fff" : meta.color,
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}

            <span
              className="channel-selector"
              role="group"
              aria-label="Select channel"
            >
              {(["L", "R"] as Channel[]).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={`channel-btn${channel === ch ? " is-active" : ""}`}
                  aria-pressed={channel === ch}
                  aria-label={`Channel ${ch}`}
                  onClick={() => setChannel(ch)}
                >
                  {ch}
                </button>
              ))}
            </span>
          </div>

          {/* SVG attenuation graph */}
          <div className="level-meter" style={{ marginBottom: 16 }}>
            <svg
              viewBox="0 0 220 110"
              style={{ width: "100%", display: "block" }}
              role="img"
              aria-label="Attenuation frequency response graph"
            >
              {/* Y-axis labels */}
              {[yMax, Math.round((yMax + yMin) / 2), 0, yMin].map((db) => {
                const y = toY(db);
                return (
                  <text
                    key={`ylabel-${db}`}
                    x="16"
                    y={y + 3}
                    textAnchor="end"
                    fontSize="6"
                    fill="var(--text-muted)"
                  >
                    {db > 0 ? `+${db}` : db}
                  </text>
                );
              })}

              {/* Graph area offset by 20px for Y labels */}
              <g transform="translate(20, 0)">
                {/* Grid lines */}
                <line x1="0" y1="10" x2="200" y2="10" stroke="var(--level-grid)" strokeWidth="0.4" />
                <line x1="0" y1="90" x2="200" y2="90" stroke="var(--level-grid)" strokeWidth="0.4" />

                {/* X frequency guides */}
                {X_GUIDES.map((hz) => {
                  const x = toX(hz);
                  const label = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
                  return (
                    <g key={`xguide-${hz}`}>
                      <line
                        x1={x}
                        y1="8"
                        x2={x}
                        y2="92"
                        stroke="var(--level-grid)"
                        strokeWidth="0.4"
                      />
                      <text
                        x={x}
                        y="100"
                        textAnchor="middle"
                        fontSize="6"
                        fill="var(--text-muted)"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* 0 dB reference line */}
                <line
                  x1="0"
                  y1={zeroY}
                  x2="200"
                  y2={zeroY}
                  stroke="var(--stroke)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x="202"
                  y={zeroY + 3}
                  fontSize="6"
                  fill="var(--text-muted)"
                >
                  0
                </text>

                {/* Attenuation curves */}
                {modeOrdered
                  .filter(
                    (m) =>
                      m !== baselineKey &&
                      captures[m] !== undefined &&
                      visibleModes.has(m),
                  )
                  .map((key) => {
                    const snap = captures[key]!;
                    const att = getAttenuation(snap);
                    const freqs = baseline!.freqs;
                    const path = buildCurvePath(freqs, att, toY);
                    if (!path) return null;
                    return (
                      <path
                        key={key}
                        d={path}
                        fill="none"
                        stroke={modeMeta[key].color}
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    );
                  })}

                {/* Empty state overlay */}
                {nonBaselineCaptured.length === 0 && (
                  <text
                    x="100"
                    y="54"
                    textAnchor="middle"
                    fontSize="8"
                    fill="var(--text-muted)"
                  >
                    Capture at least two modes to see attenuation
                  </text>
                )}
              </g>
            </svg>
          </div>

          {/* Stats row */}
          {exportableModes.length > 0 && baseline && (
            <div className="stats-row">
              {exportableModes.map((key) => {
                const snap = captures[key]!;
                const att = getAttenuation(snap);
                const peak = Math.max(...att);
                const avg = meanOf(att);
                const peakIdx = att.indexOf(peak);
                const peakHz = baseline.freqs[peakIdx];
                const meta = modeMeta[key];
                return (
                  <div
                    key={key}
                    className="stats-card"
                    style={{ borderLeft: `3px solid ${meta.color}` }}
                  >
                    <div
                      className="stats-card-label"
                      style={{ color: meta.color }}
                    >
                      {meta.label}
                    </div>
                    <div className="stats-card-text">
                      <span className="muted">Peak </span>
                      <strong>{peak.toFixed(1)} dB</strong>
                      {peakHz && (
                        <span className="muted">
                          {" "}
                          @{" "}
                          {peakHz >= 1000
                            ? `${(peakHz / 1000).toFixed(1)}k`
                            : `${Math.round(peakHz)}`}{" "}
                          Hz
                        </span>
                      )}
                    </div>
                    <div className="stats-card-text">
                      <span className="muted">Avg </span>
                      <strong>{avg.toFixed(1)} dB</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Export row */}
          <div className="action-row">
            {exportableModes.length > 0 && baseline && (
              <>
                <button
                  type="button"
                  className="skin-btn secondary"
                  onClick={() =>
                    onExportPlots(
                      baseline,
                      exportableModes.map((key) => ({
                        key,
                        label: modeMeta[key].label,
                        snapshot: captures[key]!,
                      })),
                    )
                  }
                >
                  Export Combined PNG
                </button>
                {exportableModes.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="skin-btn secondary"
                    onClick={() =>
                      onExportSquiglink(
                        baseline,
                        key,
                        modeMeta[key].label,
                        captures[key]!,
                      )
                    }
                  >
                    {modeMeta[key].label} TXT
                  </button>
                ))}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

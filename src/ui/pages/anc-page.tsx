import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { EarOff, Check } from "lucide-react";
import {
  ANC_MODE_META,
  ANC_MODE_ORDERED,
  AncCaptures,
  AncModeKey,
  AncSnapshot,
  toNumber,
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { usePawdioLabContext } from "../pawdio-context";

type Channel = "L" | "R";
type YAxisMode = "auto" | "wide" | "narrow";
type HoverItem = {
  key: AncModeKey;
  color: string;
  label: string;
  db: number;
};

const Y_AXIS_STORAGE_KEY = "pawdio-lab-anc-yaxis-v1";

const MIN_LOG = Math.log10(20);
const MAX_LOG = Math.log10(20000);
const SPAN_LOG = MAX_LOG - MIN_LOG;

function toX(hz: number): number {
  return ((Math.log10(Math.max(20, Math.min(20000, hz))) - MIN_LOG) / SPAN_LOG) * 200;
}

function fromX(x: number): number {
  const logHz = MIN_LOG + (x / 200) * SPAN_LOG;
  return Math.pow(10, logHz);
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

function fmtHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

function loadYAxisMode(): YAxisMode {
  try {
    const v = localStorage.getItem(Y_AXIS_STORAGE_KEY);
    if (v === "auto" || v === "wide" || v === "narrow") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

function saveYAxisMode(v: YAxisMode): void {
  try {
    localStorage.setItem(Y_AXIS_STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

type SessionFile = {
  app: "pawdio-lab-anc";
  version: 1;
  savedAt: string;
  baselineMode: AncModeKey | null;
  captures: AncCaptures;
  selectedModes: AncModeKey[];
};

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
  const stepIndex = ctx.ancSelectedModes.length - ctx.ancRunQueue.length - 1;
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
  const lastTestProgress = ctx.lastTestProgress;

  const modeMeta = ANC_MODE_META;
  const modeOrdered = ANC_MODE_ORDERED;
  const [visibleModes, setVisibleModes] = useState<Set<AncModeKey>>(
    new Set(["anc", "transparency"]),
  );
  const [channel, setChannel] = useState<Channel>("L");
  const [stateConfirmed, setStateConfirmed] = useState(false);
  const [yAxisMode, setYAxisModeState] = useState<YAxisMode>(loadYAxisMode);
  const [manualBaseline, setManualBaseline] = useState<AncModeKey | null>(null);
  const [hover, setHover] = useState<{ x: number; hz: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setYAxisMode = (v: YAxisMode) => {
    setYAxisModeState(v);
    saveYAxisMode(v);
  };

  // Reset confirm checkbox each time a new step prompt appears.
  useEffect(() => {
    if (stepPrompt && currentStep) setStateConfirmed(false);
  }, [stepPrompt, currentStep]);

  // Auto-baseline = first captured mode in priority order (existing behaviour).
  // Manual override: user-selected baselineKey if it has been captured.
  const autoBaselineKey: AncModeKey | undefined = ANC_MODE_ORDERED.find(
    (m) => captures[m] !== undefined,
  );
  const baselineKey: AncModeKey | undefined =
    manualBaseline && captures[manualBaseline] ? manualBaseline : autoBaselineKey;
  const baseline: AncSnapshot | undefined = baselineKey
    ? captures[baselineKey]
    : undefined;

  function getAttenuation(snap: AncSnapshot): number[] {
    if (!baseline) return [];
    const bArr = channel === "L" ? baseline.magDbLeft : baseline.magDbRight;
    const aArr = channel === "L" ? snap.magDbLeft : snap.magDbRight;
    return aArr.map((a, i) => a - bArr[i]);
  }

  const nonBaselineCaptured = modeOrdered.filter(
    (m) => m !== baselineKey && captures[m] !== undefined,
  );
  const hasTransOnly =
    nonBaselineCaptured.length === 1 && nonBaselineCaptured[0] === "transparency";

  let yMin: number;
  let yMax: number;
  if (yAxisMode === "wide") {
    yMin = -40;
    yMax = 10;
  } else if (yAxisMode === "narrow") {
    yMin = -20;
    yMax = 5;
  } else {
    yMin = hasTransOnly ? -15 : -40;
    yMax = hasTransOnly ? 15 : 10;
  }
  const ySpan = yMax - yMin;

  function toY(db: number): number {
    const clamped = Math.max(yMin, Math.min(yMax, db));
    return 10 + ((yMax - clamped) / ySpan) * 80;
  }

  const zeroY = toY(0);

  const X_GUIDES_MAJOR = [100, 500, 1000, 5000, 10000];
  const X_GUIDES_MINOR = [30, 50, 200, 300, 700, 2000, 3000, 7000, 15000];
  const Y_TICKS = useMemo(() => {
    const ticks: number[] = [yMax];
    const step = ySpan >= 40 ? 10 : 5;
    for (let v = Math.floor(yMax / step) * step; v > yMin; v -= step) {
      if (v < yMax && v > yMin && !ticks.includes(v)) ticks.push(v);
    }
    if (!ticks.includes(0) && yMin <= 0 && yMax >= 0) ticks.push(0);
    ticks.push(yMin);
    return Array.from(new Set(ticks)).sort((a, b) => b - a);
  }, [yMin, yMax, ySpan]);

  // Hover crosshair: nearest grid point info for visible modes.
  const hoverInfo = useMemo(() => {
    if (!hover || !baseline) return null;
    const freqs = baseline.freqs;
    if (!freqs.length) return null;
    const targetHz = hover.hz;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < freqs.length; i += 1) {
      const dist = Math.abs(Math.log10(freqs[i]) - Math.log10(targetHz));
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const items: HoverItem[] = [];
    for (const key of modeOrdered) {
      if (key === baselineKey) continue;
      if (!visibleModes.has(key)) continue;
      const snap = captures[key];
      if (!snap) continue;
      const att = getAttenuation(snap);
      if (att[bestIdx] === undefined) continue;
      items.push({
        key,
        color: modeMeta[key].color,
        label: modeMeta[key].label,
        db: att[bestIdx],
      });
    }
    return { hz: freqs[bestIdx], items };
    // getAttenuation closes over baseline + channel — listed deps cover both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, baseline, baselineKey, captures, visibleModes, channel]);

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
  const exportableModes =
    baseline && baselineKey
      ? modeOrdered.filter((m) => m !== baselineKey && captures[m] !== undefined)
      : [];

  const stepNum = stepIndex + 1;

  // Baseline picker — modes the user may pick as baseline (only those captured).
  const captureCount = modeOrdered.filter((m) => captures[m] !== undefined).length;

  // ---- Session save / load (B9) ----
  function handleSaveSession() {
    const payload: SessionFile = {
      app: "pawdio-lab-anc",
      version: 1,
      savedAt: new Date().toISOString(),
      baselineMode: baselineKey ?? null,
      captures,
      selectedModes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pawdio-anc-session-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleLoadSessionClick() {
    fileInputRef.current?.click();
  }

  function handleLoadSessionFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-loading same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const parsed = JSON.parse(text) as Partial<SessionFile>;
        if (parsed.app !== "pawdio-lab-anc" || parsed.version !== 1) {
          throw new Error("Not a pawdio-lab ANC session file");
        }
        if (parsed.captures && typeof parsed.captures === "object") {
          ctx.setAncCaptures(parsed.captures as AncCaptures);
        }
        if (Array.isArray(parsed.selectedModes)) {
          onChangeSelectedModes(parsed.selectedModes as AncModeKey[]);
        }
        if (parsed.baselineMode) {
          setManualBaseline(parsed.baselineMode as AncModeKey);
        }
      } catch (err) {
        ctx.setError(`Session load failed: ${String(err)}`);
      }
    };
    reader.readAsText(file);
  }

  // ---- Export All (B10) ----
  async function handleExportAll() {
    if (!baseline || !baselineKey) return;
    const modesPayload = exportableModes.map((key) => ({
      key,
      label: modeMeta[key].label,
      snapshot: captures[key]!,
    }));
    onExportPlots(baseline, modesPayload);
    for (const item of modesPayload) {
      onExportSquiglink(baseline, item.key, item.label, item.snapshot);
    }
  }

  // Stat tooltip helper — interpret peak attenuation.
  function interpretPeak(db: number, key: AncModeKey): string {
    if (key === "transparency") {
      return db > 3
        ? "Transparency overshoot vs baseline — pass-through is amplifying ambient."
        : "Transparency near baseline — pass-through restoring ambient sound.";
    }
    if (db <= -30) return "Strong cancellation — typical for closed-back ANC.";
    if (db <= -20) return "Solid cancellation in this band.";
    if (db <= -10) return "Mild cancellation.";
    return "Little or no cancellation in this band.";
  }

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
            <p className="muted" style={{ marginBottom: 12 }}>
              {modeMeta[currentStep].captureDetail}
            </p>
            {!running && (
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={stateConfirmed}
                  onChange={(e) => setStateConfirmed(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I changed the headphone state — ready to capture this mode.
                </span>
              </label>
            )}
            {running && (
              <div
                className="modal-progress-track"
                role="progressbar"
                aria-label="Recording in progress"
              >
                <div className="modal-progress-pulse" />
              </div>
            )}
            {running && lastTestProgress && (
              <p
                className="muted"
                style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}
              >
                {lastTestProgress.message}
              </p>
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
                disabled={running || !stateConfirmed}
                onClick={onConfirmStep}
              >
                {running ? "Recording…" : "Start Recording"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-page sticky progress (B7) */}
      {running && lastTestProgress && (
        <div
          className="page-card"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 14px",
            background: "var(--surface-2, var(--surface-1))",
            borderLeft: "3px solid var(--accent-9)",
          }}
          role="status"
          aria-live="polite"
        >
          <div className="modal-progress-track" style={{ flex: 1, height: 6 }}>
            <div className="modal-progress-pulse" />
          </div>
          <span style={{ fontSize: 11 }}>
            {currentStep && (
              <strong style={{ color: modeMeta[currentStep].color }}>
                {modeMeta[currentStep].captureTitle}
                {" · "}
              </strong>
            )}
            {lastTestProgress.message}
          </span>
        </div>
      )}

      {/* Hidden file input for session load */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={handleLoadSessionFile}
      />

      {/* Config card */}
      <section className="page-card">
        <h2 className="section-heading">ANC / Transparency Measurement</h2>

        <section className="page-section">
          <h3 className="section-subheading">Select Modes</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            Each mode = one short sweep capture. Choose every state you want to
            compare. The first captured mode (in priority order) becomes the
            baseline; you can override below after capture.
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
                  title={meta.helpText}
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
                  <div
                    className="muted"
                    style={{
                      fontSize: 10,
                      marginTop: 6,
                      lineHeight: 1.3,
                    }}
                  >
                    {meta.helpText}
                  </div>
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
            className="skin-btn secondary"
            onClick={handleLoadSessionClick}
            disabled={running}
            title="Load a previously saved ANC session JSON"
          >
            Load Session
          </button>
          {hasAnyCapture && (
            <button
              type="button"
              className="skin-btn secondary"
              onClick={handleSaveSession}
              title="Download all captures + selected modes as JSON"
            >
              Save Session
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

            {/* Y-axis scale toggle (B3) */}
            <span
              className="channel-selector"
              role="group"
              aria-label="Y-axis scale"
              title="Y-axis range"
            >
              {(["auto", "wide", "narrow"] as YAxisMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`channel-btn${yAxisMode === mode ? " is-active" : ""}`}
                  aria-pressed={yAxisMode === mode}
                  onClick={() => setYAxisMode(mode)}
                  title={
                    mode === "auto"
                      ? "Auto fit to data"
                      : mode === "wide"
                        ? "-40 to +10 dB (full ANC range)"
                        : "-20 to +5 dB (zoom)"
                  }
                >
                  {mode === "auto" ? "Auto" : mode === "wide" ? "Wide" : "Zoom"}
                </button>
              ))}
            </span>

            {/* Baseline picker (B5) */}
            {captureCount >= 2 && (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                }}
                title="Compare other modes against this baseline"
              >
                <span className="muted">Baseline:</span>
                <select
                  className="skin-input"
                  style={{ padding: "4px 8px", fontSize: 11 }}
                  value={baselineKey ?? ""}
                  onChange={(e) =>
                    setManualBaseline((e.target.value as AncModeKey) || null)
                  }
                >
                  {modeOrdered
                    .filter((m) => captures[m] !== undefined)
                    .map((m) => (
                      <option key={m} value={m}>
                        {modeMeta[m].label}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>

          {/* SVG attenuation graph */}
          <div className="level-meter" style={{ marginBottom: 16 }}>
            <svg
              viewBox="0 0 220 110"
              style={{ width: "100%", display: "block" }}
              role="img"
              aria-label="Attenuation frequency response graph"
              onMouseMove={(e) => {
                const svg = e.currentTarget;
                const rect = svg.getBoundingClientRect();
                const px = ((e.clientX - rect.left) / rect.width) * 220 - 20;
                if (px < 0 || px > 200) {
                  setHover(null);
                  return;
                }
                setHover({ x: px, hz: fromX(px) });
              }}
              onMouseLeave={() => setHover(null)}
            >
              {/* Y-axis labels */}
              {Y_TICKS.map((db) => {
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
                {/* Top + bottom border */}
                <line
                  x1="0"
                  y1="10"
                  x2="200"
                  y2="10"
                  stroke="var(--level-grid)"
                  strokeWidth="0.4"
                />
                <line
                  x1="0"
                  y1="90"
                  x2="200"
                  y2="90"
                  stroke="var(--level-grid)"
                  strokeWidth="0.4"
                />

                {/* Minor x-grid (B6) */}
                {X_GUIDES_MINOR.map((hz) => {
                  const x = toX(hz);
                  return (
                    <line
                      key={`xminor-${hz}`}
                      x1={x}
                      y1="10"
                      x2={x}
                      y2="90"
                      stroke="var(--level-grid)"
                      strokeWidth="0.2"
                      opacity="0.45"
                    />
                  );
                })}

                {/* Major x-grid + labels */}
                {X_GUIDES_MAJOR.map((hz) => {
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
                <text x="202" y={zeroY + 3} fontSize="6" fill="var(--text-muted)">
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

                {/* Hover crosshair (B8) */}
                {hover && hoverInfo && (
                  <g pointerEvents="none">
                    <line
                      x1={hover.x}
                      y1="10"
                      x2={hover.x}
                      y2="90"
                      stroke="var(--accent-9)"
                      strokeWidth="0.5"
                      opacity="0.7"
                    />
                    {hoverInfo.items.map((item) => {
                      const cy = toY(item.db);
                      return (
                        <circle
                          key={item.key}
                          cx={hover.x}
                          cy={cy}
                          r="1.8"
                          fill={item.color}
                          stroke="#fff"
                          strokeWidth="0.4"
                        />
                      );
                    })}
                  </g>
                )}

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

          {/* Hover readout (B8) */}
          {hover && hoverInfo && hoverInfo.items.length > 0 && (
            <div
              className="muted"
              style={{
                fontSize: 11,
                marginBottom: 12,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <strong style={{ color: "var(--text)" }}>{fmtHz(hoverInfo.hz)} Hz</strong>
              {hoverInfo.items.map((item) => (
                <span key={item.key} style={{ color: item.color }}>
                  {item.label}: <strong>{item.db.toFixed(1)} dB</strong>
                </span>
              ))}
            </div>
          )}

          {/* Stats row */}
          {exportableModes.length > 0 && baseline && (
            <div className="stats-row">
              {exportableModes.map((key) => {
                const snap = captures[key]!;
                const att = getAttenuation(snap);
                // Strongest cancellation = most negative value.
                const peak = Math.min(...att);
                const avg = meanOf(att);
                const peakIdx = att.indexOf(peak);
                const peakHz = baseline.freqs[peakIdx];
                const meta = modeMeta[key];
                return (
                  <div
                    key={key}
                    className="stats-card"
                    style={{ borderLeft: `3px solid ${meta.color}` }}
                    title={interpretPeak(peak, key)}
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
                          @ {fmtHz(peakHz)} Hz
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
                  className="skin-btn"
                  onClick={handleExportAll}
                  title="Export combined PNG and one TXT per non-baseline mode"
                >
                  Export All
                </button>
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

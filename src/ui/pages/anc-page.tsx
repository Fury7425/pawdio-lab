import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { EarOff, Check } from "lucide-react";
import {
  ANC_MODE_META,
  ANC_MODE_ORDERED,
  AncCaptures,
  AncModeKey,
  AncSnapshot,
  CAPTURE_ORDER_META,
  type CaptureOrder,
  toNumber,
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { Modal } from "../components/modal";
import { ChartLegend } from "../components/chart-legend";
import { OverlayChart, type OverlaySeries } from "../components/overlay-chart";
import { fmtHz } from "../lib/chart-scale";
import { usePawdioLabContext } from "../pawdio-context";

type Channel = "L" | "R" | "both" | "avg";
type YAxisMode = "auto" | "wide" | "narrow";

const CHANNEL_LABELS: Record<Channel, string> = {
  L: "L",
  R: "R",
  both: "Both",
  avg: "Avg",
};

const Y_AXIS_STORAGE_KEY = "pawdio-lab-anc-yaxis-v1";

function fmtTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return timestamp.slice(11, 19);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp.slice(0, 8);
  }
}

function meanOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
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
  const totalSteps = ctx.ancTotalSteps;
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
    manualBaseline && captures[manualBaseline]
      ? manualBaseline
      : autoBaselineKey;
  const baseline: AncSnapshot | undefined = baselineKey
    ? captures[baselineKey]
    : undefined;

  // Attenuation for one physical channel = snapshot mag − baseline mag.
  function attenSide(snap: AncSnapshot, side: "L" | "R"): number[] {
    if (!baseline) return [];
    const bArr = side === "L" ? baseline.magDbLeft : baseline.magDbRight;
    const aArr = side === "L" ? snap.magDbLeft : snap.magDbRight;
    return aArr.map((a, i) => a - (bArr[i] ?? NaN));
  }

  // Mean of L and R attenuation; falls back to whichever side has data.
  function attenAvg(snap: AncSnapshot): number[] {
    const l = attenSide(snap, "L");
    const r = attenSide(snap, "R");
    if (l.length === 0) return r;
    if (r.length === 0) return l;
    const n = Math.min(l.length, r.length);
    return Array.from({ length: n }, (_, i) => (l[i] + r[i]) / 2);
  }

  // Single curve used for per-mode stats: a chosen side, or the average
  // (both `avg` and `both` collapse to the average for the numeric summary).
  function statAtten(snap: AncSnapshot): number[] {
    return channel === "L" || channel === "R"
      ? attenSide(snap, channel)
      : attenAvg(snap);
  }

  const nonBaselineCaptured = modeOrdered.filter(
    (m) => m !== baselineKey && captures[m] !== undefined,
  );
  const hasTransOnly =
    nonBaselineCaptured.length === 1 &&
    nonBaselineCaptured[0] === "transparency";

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
  // One drawable line per visible non-baseline mode. `both` expands each mode
  // into two lines (L solid, R dashed); `avg` collapses to a single mean line.
  const chartSeries = useMemo<OverlaySeries[]>(() => {
    if (!baseline) return [];
    const freqs = baseline.freqs;
    const out: OverlaySeries[] = [];
    for (const key of modeOrdered) {
      if (key === baselineKey || !visibleModes.has(key)) continue;
      const snap = captures[key];
      if (!snap) continue;
      const meta = modeMeta[key];
      if (channel === "both") {
        out.push({
          id: `${key}-L`,
          label: `${meta.label} (L)`,
          color: meta.color,
          freqs,
          values: attenSide(snap, "L"),
        });
        out.push({
          id: `${key}-R`,
          label: `${meta.label} (R)`,
          color: meta.color,
          dash: "2.5 2",
          freqs,
          values: attenSide(snap, "R"),
        });
      } else {
        out.push({
          id: key,
          label: channel === "avg" ? `${meta.label} (avg)` : meta.label,
          color: meta.color,
          freqs,
          values: channel === "avg" ? attenAvg(snap) : attenSide(snap, channel),
        });
      }
    }
    return out;
    // attenSide/attenAvg close over baseline + channel — listed deps cover both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, baselineKey, captures, visibleModes, channel]);

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
      ? modeOrdered.filter(
          (m) => m !== baselineKey && captures[m] !== undefined,
        )
      : [];

  const stepNum = totalSteps - ctx.ancRunQueue.length;
  const sideLabel = (side: "both" | "left" | "right") =>
    side === "left" ? "LEFT ear" : side === "right" ? "RIGHT ear" : null;

  // Baseline picker — modes the user may pick as baseline (only those captured).
  const captureCount = modeOrdered.filter(
    (m) => captures[m] !== undefined,
  ).length;

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
        <Modal
          open
          onClose={() => {
            if (!running) onCancelStep();
          }}
          footer={
            <>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={running}
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
            </>
          }
        >
          <p className="modal-step-label">
            Step {stepNum} of {totalSteps}
          </p>
          <div
            className="modal-icon-circle"
            style={{ background: modeMeta[currentStep.mode].color }}
          >
            <EarOff size={18} color="var(--button-text)" />
          </div>
          <h3 className="section-heading" style={{ marginBottom: 6 }}>
            {modeMeta[currentStep.mode].captureTitle}
            {sideLabel(currentStep.side) && (
              <span style={{ color: modeMeta[currentStep.mode].color }}>
                {" — "}
                {sideLabel(currentStep.side)}
              </span>
            )}
          </h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            {modeMeta[currentStep.mode].captureDetail}
            {sideLabel(currentStep.side) &&
              ` Place the mic on the ${sideLabel(currentStep.side)} and keep this mode set.`}
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
        </Modal>
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
              <strong style={{ color: modeMeta[currentStep.mode].color }}>
                {modeMeta[currentStep.mode].captureTitle}
                {sideLabel(currentStep.side)
                  ? ` (${sideLabel(currentStep.side)})`
                  : ""}
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
                    <span
                      className="mode-select-check"
                      style={{ color: meta.color }}
                    >
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
            <div className="field-row">
              <span className="field-label">Capture</span>
              <span
                className="channel-selector"
                role="group"
                aria-label="Capture order"
              >
                {(
                  ["stereo", "left_first", "right_first"] as CaptureOrder[]
                ).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`channel-btn${
                      (request.captureOrder ?? "stereo") === opt
                        ? " is-active"
                        : ""
                    }`}
                    aria-pressed={(request.captureOrder ?? "stereo") === opt}
                    title={CAPTURE_ORDER_META[opt].detail}
                    onClick={() =>
                      onChangeRequest({ ...request, captureOrder: opt })
                    }
                  >
                    {CAPTURE_ORDER_META[opt].label}
                  </button>
                ))}
              </span>
            </div>
          </div>
          {(request.captureOrder ?? "stereo") !== "stereo" && (
            <p className="muted" style={{ marginTop: 8, fontSize: 11 }}>
              Mono mode: each selected mode is captured one ear at a time
              {" — "}
              {CAPTURE_ORDER_META[request.captureOrder].detail.toLowerCase()}.
              You will be prompted to reposition a single mic between sides.
            </p>
          )}
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
            className={`skin-btn${running ? " is-loading" : ""}`}
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
                      color: active ? "var(--button-text)" : meta.color,
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
              {(["L", "R", "both", "avg"] as Channel[]).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={`channel-btn${channel === ch ? " is-active" : ""}`}
                  aria-pressed={channel === ch}
                  aria-label={`Channel ${CHANNEL_LABELS[ch]}`}
                  onClick={() => setChannel(ch)}
                >
                  {CHANNEL_LABELS[ch]}
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

          {/* SVG attenuation graph with built-in hover tooltip */}
          <div className="level-meter" style={{ marginBottom: 16 }}>
            <OverlayChart
              series={chartSeries}
              yMin={yMin}
              yMax={yMax}
              ariaLabel="Attenuation frequency response graph"
              emptyMessage="Capture at least two modes to see attenuation"
            />
          </div>

          <ChartLegend items={chartSeries} />

          {/* Stats row */}
          {exportableModes.length > 0 && baseline && (
            <div className="stats-row">
              {exportableModes.map((key) => {
                const snap = captures[key]!;
                const att = statAtten(snap);
                // Guard against an empty / all-NaN curve (e.g. viewing a channel
                // that wasn't captured) so the cards don't show "Infinity"/"NaN".
                const finite = att.filter((v) => Number.isFinite(v));
                const hasData = finite.length > 0;
                // Strongest cancellation = most negative value.
                const peak = hasData ? Math.min(...finite) : NaN;
                const avg = hasData ? meanOf(finite) : NaN;
                const peakIdx = hasData ? att.indexOf(peak) : -1;
                const peakHz =
                  peakIdx >= 0 ? baseline.freqs[peakIdx] : undefined;
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
                      <strong>{hasData ? `${peak.toFixed(1)} dB` : "—"}</strong>
                      {peakHz && (
                        <span className="muted"> @ {fmtHz(peakHz)} Hz</span>
                      )}
                    </div>
                    <div className="stats-card-text">
                      <span className="muted">Avg </span>
                      <strong>{hasData ? `${avg.toFixed(1)} dB` : "—"}</strong>
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

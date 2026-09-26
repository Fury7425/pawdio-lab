import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock, Play } from "lucide-react";
import { DEFAULT_OUTPUT_LABEL, fmtMs, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { ChipGroup } from "../components/chip-group";
import { EmptyState } from "../components/empty-state";
import { ExportMenu } from "../components/export-menu";
import { CheckboxField, RangeField } from "../components/form-fields";
import { MetricCard, type MetricTier } from "../components/metric-card";
import { PageHeader } from "../components/page-header";
import { RunBar } from "../components/run-bar";
import { useShortcutBindings } from "../hooks/use-shortcuts";
import { usePawdioLabContext } from "../pawdio-context";

// Same bands as the exported text report (latency_performance_label and
// latency_consistency_label in src-tauri/src/audio/mod.rs), so the colour
// on screen and the verdict in the file agree.
function delayTier(ms: number | null | undefined): MetricTier | null {
  if (ms == null) return null;
  if (ms <= 40) return "good";
  if (ms <= 80) return "warn";
  return "bad";
}

function consistencyTier(ms: number | null | undefined): MetricTier | null {
  if (ms == null) return null;
  if (ms <= 10) return "good";
  if (ms <= 30) return "warn";
  return "bad";
}

const LATENCY_UI_STORAGE_KEY = "pawdio-lab-latency-ui-v1";

type PresetKey = "chirp200" | "chirp5k" | "chirp10k";

type PresetSelection = Record<PresetKey, boolean>;

/** Display and run order of the latency presets. */
const PRESET_OPTIONS: Array<{ key: PresetKey; label: string }> = [
  { key: "chirp200", label: "200 Hz Chirp" },
  { key: "chirp5k", label: "5 kHz Chirp" },
  { key: "chirp10k", label: "10 kHz Chirp" },
];

const ALL_PRESETS_SELECTED: PresetSelection = {
  chirp200: true,
  chirp5k: true,
  chirp10k: true,
};

/**
 * Keep only the current preset keys from a stored selection. Prefs saved by
 * the old beep/click presets carry none of them and fall back to all-on.
 */
function normalizeSelection(value: unknown): PresetSelection {
  if (!value || typeof value !== "object") return ALL_PRESETS_SELECTED;
  const stored = value as Record<string, unknown>;
  const known = PRESET_OPTIONS.filter(
    ({ key }) => typeof stored[key] === "boolean",
  );
  if (known.length === 0) return ALL_PRESETS_SELECTED;
  const next = { ...ALL_PRESETS_SELECTED };
  for (const { key } of known) next[key] = stored[key] as boolean;
  return next;
}

function selectedKeys(selection: PresetSelection): PresetKey[] {
  return PRESET_OPTIONS.map(({ key }) => key).filter((key) => selection[key]);
}

/**
 * The presets ticked under "Run Delay Tests", as last saved. Lets the start
 * shortcut run exactly what the Run Selected button would.
 */
export function readLatencyRunSelection(): PresetKey[] {
  return selectedKeys(normalizeSelection(readLatencyUiPrefs()?.runSelection));
}

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

/** Preset each suite entry was run with, matched by its centre frequency. */
const PRESET_FREQUENCY: Record<PresetKey, number> = {
  chirp200: 200,
  chirp5k: 5000,
  chirp10k: 10000,
};

function niceStep(span: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  return steps.find((step) => span / step <= 5) ?? 1000;
}

type PlotRow = {
  label: string;
  delays: number[];
  mean: number | null;
  note: string | null;
};

/**
 * Every repeat as a dot, one row per preset, with the preset's mean as a tick.
 * Makes jitter and preset-to-preset differences visible at a glance.
 */
function LatencyDotPlot({ rows }: { rows: PlotRow[] }) {
  const values = rows.flatMap((row) => row.delays);
  if (values.length === 0) return null;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 2) {
    const centre = (min + max) / 2;
    min = centre - 1;
    max = centre + 1;
  }
  const step = niceStep(max - min);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);

  const left = 110;
  const right = 860;
  const rowHeight = 34;
  const height = rows.length * rowHeight + 26;
  const x = (ms: number) => left + ((ms - lo) / (hi - lo)) * (right - left);
  // Spread repeats vertically so identical values stay countable.
  const jitter = (i: number) => ((i % 5) - 2) * 2.5;

  return (
    <svg
      className="latency-dot-plot"
      viewBox={`0 0 940 ${height}`}
      role="img"
      aria-label="Delay of every repeat, grouped by preset"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            className="dot-plot-grid"
            x1={x(tick)}
            x2={x(tick)}
            y1={4}
            y2={height - 22}
          />
          <text
            className="dot-plot-axis"
            x={x(tick)}
            y={height - 6}
            textAnchor="middle"
          >
            {Number(tick.toFixed(2))} ms
          </text>
        </g>
      ))}
      {rows.map((row, rowIndex) => {
        const y = rowIndex * rowHeight + 20;
        return (
          <g key={row.label}>
            <text className="dot-plot-label" x={0} y={y + 4}>
              {row.label}
            </text>
            <line className="dot-plot-row" x1={left} x2={right} y1={y} y2={y} />
            {row.delays.map((delay, i) => (
              <circle
                key={i}
                className="dot-plot-dot"
                cx={x(delay)}
                cy={y + jitter(i)}
                r={4.5}
              />
            ))}
            {row.mean !== null && (
              <line
                className="dot-plot-mean"
                x1={x(row.mean)}
                x2={x(row.mean)}
                y1={y - 11}
                y2={y + 11}
              />
            )}
            <text
              className={`dot-plot-note${row.note ? " is-live" : ""}`}
              x={940}
              y={y + 4}
              textAnchor="end"
            >
              {row.note ?? (row.mean !== null ? fmtMs(row.mean) : "-")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function LatencyPage() {
  const ctx = usePawdioLabContext();
  const { bindings } = useShortcutBindings();
  const request = ctx.latencyRequest;
  const onChangeRequest = ctx.setLatencyRequest;
  const progressRows = ctx.latencyProgress;
  const report = ctx.latencyReport;
  const suite = ctx.latencySuite;
  const active = ctx.latencyActivePreset;
  const running = ctx.running;
  const onRunSelected = (keys: PresetKey[]) =>
    ctx.run(ctx.runLatencySelectedTests(keys));
  const onRunAll = () => ctx.run(ctx.runLatencyAllTests());
  const onSaveReport = () => ctx.run(ctx.exportLatencyReport());
  const onExportCsv = () => ctx.run(ctx.exportLatencyCsv());
  const onBrowseOutputFolder = () => ctx.run(ctx.browseLatencyOutputFolder());
  const onCalibrateSelected = (keys: PresetKey[], repeats: number) =>
    ctx.run(ctx.calibrateLatencySelected(keys, repeats));
  const onCalibrateAll = (repeats: number) =>
    ctx.run(ctx.calibrateLatencyAllPresets(repeats));
  const storedUiPrefs = useMemo(() => readLatencyUiPrefs(), []);
  const [runSelection, setRunSelection] = useState<PresetSelection>(() =>
    normalizeSelection(storedUiPrefs?.runSelection),
  );
  const [calibrationRepeats, setCalibrationRepeats] = useState(
    storedUiPrefs?.calibrationRepeats ?? 5,
  );
  const [calibrationMode, setCalibrationMode] = useState<PresetSelection>(() =>
    normalizeSelection(storedUiPrefs?.calibrationMode),
  );

  useEffect(() => {
    const snapshot: LatencyUiPrefs = {
      runSelection,
      calibrationRepeats,
      calibrationMode,
    };
    try {
      localStorage.setItem(LATENCY_UI_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage write failures
    }
  }, [runSelection, calibrationRepeats, calibrationMode]);

  const latestRow =
    progressRows.length > 0 ? progressRows[progressRows.length - 1] : null;

  // Progress events carry raw delays; subtract the running preset's offset so
  // "Last repeat" sits on the same calibrated scale as Average. Once a suite
  // ends, the last repeat comes from the calibrated report instead.
  const lastDelay = (() => {
    if (active && !active.calibrating && latestRow?.delayMs != null) {
      return latestRow.delayMs - active.offsetMs;
    }
    const measured = (report?.measurements ?? [])
      .map((m) => m.delayMs)
      .filter((value): value is number => value !== null);
    return measured.length > 0 ? measured[measured.length - 1] : null;
  })();

  // The metric cards show the most recent preset's report; name it.
  const lastEntry = suite.length > 0 ? suite[suite.length - 1] : null;
  const reportPreset = report
    ? PRESET_OPTIONS.find(
        ({ key }) => lastEntry?.request.frequencyHz === PRESET_FREQUENCY[key],
      )?.label
    : undefined;

  const plotRows: PlotRow[] = PRESET_OPTIONS.map(({ key, label }) => {
    const entry = suite.find(
      (item) => item.request.frequencyHz === PRESET_FREQUENCY[key],
    );
    const delays = (entry?.report.measurements ?? [])
      .map((m) => m.delayMs)
      .filter((value): value is number => value !== null);
    const measuring =
      running &&
      active !== null &&
      !active.calibrating &&
      active.label === label;
    return {
      label,
      delays,
      mean: entry?.report.averageDelayMs ?? null,
      note:
        measuring && latestRow
          ? `Measuring ${latestRow.current} / ${latestRow.total}`
          : null,
    };
  });
  const hasPlot = plotRows.some((row) => row.delays.length > 0);

  // Whole-suite progress: finished presets plus the fraction of this one.
  const suiteProgress = active
    ? ((active.index +
        (latestRow && latestRow.total > 0
          ? latestRow.current / latestRow.total
          : 0)) /
        active.count) *
      100
    : null;

  const runStatus = active ? (
    <>
      <strong className="run-bar-emph">
        {active.calibrating ? "Calibrating " : ""}
        {active.label}
      </strong>
      {latestRow && ` · repeat ${latestRow.current} of ${latestRow.total}`}
      {active.count > 1 && ` · preset ${active.index + 1} of ${active.count}`}
    </>
  ) : running ? (
    "Starting"
  ) : (
    `Ready · ${selectedKeys(runSelection).length} of ${PRESET_OPTIONS.length} presets selected, ${request.repeats} repeats each`
  );

  return (
    <div className="page-stack">
      <section className="page-card">
        <PageHeader
          title="Latency"
          description="Output-to-input delay, measured with one-octave chirps at 200 Hz, 5 kHz and 10 kHz."
          actions={
            <ExportMenu
              disabled={!report || running}
              items={[
                {
                  label: "Save Text Report",
                  onSelect: onSaveReport,
                  disabled: !report || running,
                },
                {
                  label: "Export CSV",
                  onSelect: onExportCsv,
                  disabled: !report || running,
                },
              ]}
            />
          }
        />

        <div className="metric-grid">
          <MetricCard
            label={reportPreset ? `Average · ${reportPreset}` : "Average"}
            value={fmtMs(report?.averageDelayMs ?? null)}
            tier={delayTier(report?.averageDelayMs)}
          />
          <MetricCard
            label={reportPreset ? `Std Dev · ${reportPreset}` : "Std Dev"}
            value={fmtMs(report?.stdDevMs ?? null)}
            tier={consistencyTier(report?.stdDevMs)}
          />
          <MetricCard
            label="Last repeat"
            value={fmtMs(lastDelay)}
            tier={delayTier(lastDelay)}
          />
        </div>
        <p className="tier-legend">
          <span>
            <i className="tier-swatch is-good" aria-hidden="true" />
            Good: delay up to 40 ms, std dev up to 10 ms
          </span>
          <span>
            <i className="tier-swatch is-warn" aria-hidden="true" />
            Moderate: up to 80 ms, up to 30 ms
          </span>
          <span>
            <i className="tier-swatch is-bad" aria-hidden="true" />
            Poor: above that
          </span>
        </p>

        <div className="inset-panel mt-12">
          <div className="inset-panel-head">
            <h3 className="section-subheading">Per-repeat delay</h3>
            <span className="muted compact-note">
              Dot = one repeat · bar = preset mean
            </span>
          </div>
          {hasPlot ? (
            <LatencyDotPlot rows={plotRows} />
          ) : (
            <EmptyState
              icon={<Clock size={28} />}
              message={
                running
                  ? "Each preset appears here when it finishes"
                  : "Run a test to see the delay of every repeat"
              }
            />
          )}
        </div>
      </section>

      <section className="page-card">
        <h3 className="section-subheading">Test settings</h3>
        <ChipGroup
          options={PRESET_OPTIONS}
          selected={runSelection}
          onToggle={(key) =>
            setRunSelection((prev) => ({ ...prev, [key]: !prev[key] }))
          }
          ariaLabel="Latency test presets"
        />

        <div className="field-grid-4 mt-12">
          <LabeledNumberInput
            label="Repeats"
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
          <LabeledNumberInput
            label="Duration (s)"
            value={request.durationSecs}
            step={0.05}
            onChange={(event) =>
              onChangeRequest({
                ...request,
                durationSecs: toNumber(event.target.value, 0.5),
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
                amplitude: toNumber(event.target.value, 0.85),
              })
            }
          />
          <LabeledNumberInput
            label="Record Margin (s)"
            value={request.recordMarginSecs}
            step={0.1}
            min={0.1}
            onChange={(event) =>
              onChangeRequest({
                ...request,
                recordMarginSecs: toNumber(event.target.value, 1),
              })
            }
          />
        </div>

        <div className="fold-list mt-12">
          <details className="fold">
            <summary>
              <ChevronRight
                size={14}
                className="fold-chevron"
                aria-hidden="true"
              />
              Output folder and plots
              <span className="fold-summary">
                {request.outputDir || DEFAULT_OUTPUT_LABEL} ·{" "}
                {Number(request.savePerSoundPlot) +
                  Number(request.saveOverallBarChart)}{" "}
                of 2 plots on
              </span>
            </summary>
            <div className="fold-body">
              <div className="field-grid-2">
                <CheckboxField
                  label="Save per-sound plot"
                  checked={request.savePerSoundPlot}
                  onChange={(checked) =>
                    onChangeRequest({ ...request, savePerSoundPlot: checked })
                  }
                />
                <CheckboxField
                  label="Save overall bar chart"
                  checked={request.saveOverallBarChart}
                  onChange={(checked) =>
                    onChangeRequest({
                      ...request,
                      saveOverallBarChart: checked,
                    })
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

          <details className="fold">
            <summary>
              <ChevronRight
                size={14}
                className="fold-chevron"
                aria-hidden="true"
              />
              Calibration
              <span className="fold-summary">
                Subtracts your loopback delay from every result
              </span>
            </summary>
            <div className="fold-body">
              <ChipGroup
                options={PRESET_OPTIONS}
                selected={calibrationMode}
                onToggle={(key) =>
                  setCalibrationMode((prev) => ({
                    ...prev,
                    [key]: !prev[key],
                  }))
                }
                ariaLabel="Calibration presets"
              />

              <RangeField
                className="mt-12"
                label="Repeats"
                min={1}
                max={20}
                step={1}
                value={calibrationRepeats}
                onChange={(value) => setCalibrationRepeats(Math.round(value))}
              />

              <div className="btn-row mt-12">
                <button
                  type="button"
                  className="skin-btn secondary"
                  disabled={running}
                  onClick={() =>
                    onCalibrateSelected(
                      selectedKeys(calibrationMode),
                      calibrationRepeats,
                    )
                  }
                >
                  Calibrate Selected
                </button>
                <button
                  type="button"
                  className="skin-btn secondary"
                  disabled={running}
                  onClick={() => onCalibrateAll(calibrationRepeats)}
                >
                  Calibrate All
                </button>
              </div>

              <div className="scroll-box mt-10">
                <pre className="mono-pre">{ctx.calibrationText}</pre>
              </div>
            </div>
          </details>
        </div>
      </section>

      <RunBar
        actions={
          <>
            <button
              type="button"
              className={`skin-btn${running ? " is-loading" : ""}`}
              disabled={running}
              onClick={() => onRunSelected(selectedKeys(runSelection))}
            >
              <Play size={12} fill="currentColor" aria-hidden="true" />
              Run Selected
              {bindings.start_test && (
                <kbd className="btn-kbd">{bindings.start_test}</kbd>
              )}
            </button>
            <button
              type="button"
              className="skin-btn secondary"
              disabled={running}
              onClick={onRunAll}
            >
              Run All
            </button>
          </>
        }
        status={runStatus}
        detail={
          suiteProgress !== null ? `${Math.floor(suiteProgress)}%` : undefined
        }
        progress={suiteProgress}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { fmtMs, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { DropdownMenu } from "../components/dropdown-menu";
import { usePawdioLabContext } from "../pawdio-context";

function metricTier(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 15) return "metric-good";
  if (ms < 40) return "metric-warn";
  return "metric-bad";
}

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

export function LatencyPage() {
  const ctx = usePawdioLabContext();
  const request = ctx.latencyRequest;
  const onChangeRequest = ctx.setLatencyRequest;
  const progressRows = ctx.latencyProgress;
  const report = ctx.latencyReport;
  const calibrationText = ctx.calibrationText;
  const running = ctx.running;
  const progressPercent = ctx.latencyProgressPercent;
  type PresetKey = "beep1k" | "beep2k" | "beep5k" | "beep200" | "impulse";
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
  const [runSelection, setRunSelection] = useState<PresetSelection>(
    storedUiPrefs?.runSelection ?? {
      beep200: true,
      beep1k: true,
      beep2k: true,
      beep5k: true,
      impulse: false,
    },
  );
  const [calibrationRepeats, setCalibrationRepeats] = useState(
    storedUiPrefs?.calibrationRepeats ?? 5,
  );
  const [calibrationMode, setCalibrationMode] = useState<PresetSelection>(
    storedUiPrefs?.calibrationMode ?? {
      beep200: true,
      beep1k: true,
      beep2k: true,
      beep5k: true,
      impulse: true,
    },
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

  const breakdownText = useMemo(() => {
    if (progressRows.length === 0) {
      return null;
    }

    return progressRows
      .map(
        (row) => `${row.current}/${row.total}  |  delay=${fmtMs(row.delayMs)}`,
      )
      .join("\n");
  }, [progressRows]);

  const lastDelay =
    progressRows.length > 0
      ? progressRows[progressRows.length - 1].delayMs
      : null;

  const presetOptions = [
    {
      key: "beep200",
      label: "200Hz Low Beep",
      signal: "sine" as const,
      frequencyHz: 200,
    },
    {
      key: "beep1k",
      label: "1kHz Beep",
      signal: "sine" as const,
      frequencyHz: 1000,
    },
    {
      key: "beep2k",
      label: "Mixed (2kHz Sine)",
      signal: "sine" as const,
      frequencyHz: 2000,
    },
    {
      key: "beep5k",
      label: "5kHz Beep",
      signal: "sine" as const,
      frequencyHz: 5000,
    },
    {
      key: "impulse",
      label: "Click (Impulse)",
      signal: "impulse" as const,
      frequencyHz: request.frequencyHz,
    },
  ];

  function isRunPresetEnabled(key: keyof typeof runSelection) {
    return runSelection[key];
  }

  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Latency</h2>

        <section className="page-section">
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
                    [preset.key]: !prev[preset.key as keyof typeof prev],
                  }))
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="range-line mt-12">
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
                  repeats: Math.max(
                    1,
                    Math.round(toNumber(event.target.value, 5)),
                  ),
                })
              }
            />
            <span>{request.repeats}</span>
          </div>

          <div className="field-grid-4 mt-12">
            <LabeledNumberInput
              label="Frequency (Hz)"
              value={request.frequencyHz}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  frequencyHz: toNumber(event.target.value, 1000),
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

          <div className="field-grid-2 mt-12">
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={request.savePerSoundPlot}
                onChange={(event) =>
                  onChangeRequest({
                    ...request,
                    savePerSoundPlot: event.target.checked,
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
                    saveOverallBarChart: event.target.checked,
                  })
                }
              />
              Save overall bar chart
            </label>
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
            </div>
          </div>

          <div className="action-row">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="skin-btn"
                disabled={running}
                onClick={() => {
                  const keys = (
                    Object.entries(runSelection) as Array<
                      [
                        "beep200" | "beep1k" | "beep2k" | "beep5k" | "impulse",
                        boolean,
                      ]
                    >
                  )
                    .filter(([, enabled]) => enabled)
                    .map(([key]) => key)
                    .sort((a, b) => {
                      const order = [
                        "beep1k",
                        "beep2k",
                        "beep5k",
                        "beep200",
                        "impulse",
                      ];
                      return order.indexOf(a) - order.indexOf(b);
                    });
                  onRunSelected(keys);
                }}
              >
                Run Selected
              </button>
              <button
                type="button"
                className="skin-btn secondary"
                disabled={running}
                onClick={onRunAll}
              >
                Run ALL
              </button>
            </div>
            <DropdownMenu label="Export" disabled={!report || running}>
              <button
                type="button"
                className="dropdown-item"
                disabled={!report || running}
                onClick={onSaveReport}
              >
                Save Text Report
              </button>
              <button
                type="button"
                className="dropdown-item"
                disabled={!report || running}
                onClick={onExportCsv}
              >
                Export CSV
              </button>
            </DropdownMenu>
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Results Summary</h3>

          <div className="metric-grid">
            <article className={`metric-card ${metricTier(report?.averageDelayMs)}`}>
              <p className="metric-label">Average (ms)</p>
              <p className="metric-value">
                {fmtMs(report?.averageDelayMs ?? null)}
              </p>
            </article>
            <article className={`metric-card ${metricTier(report?.stdDevMs)}`}>
              <p className="metric-label">Std Dev (ms)</p>
              <p className="metric-value">{fmtMs(report?.stdDevMs ?? null)}</p>
            </article>
            <article className={`metric-card ${metricTier(lastDelay)}`}>
              <p className="metric-label">Last (ms)</p>
              <p className="metric-value">{fmtMs(lastDelay)}</p>
            </article>
          </div>

          <div className="mt-10">
            <p className="field-label" style={{ marginBottom: 6 }}>
              Progress {progressPercent}% | Signal {request.signal}
            </p>
            <div className="progress-track">
              <div
                className={`progress-fill${running ? " is-running" : ""}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="mt-10">
            <p className="field-label">Detailed Breakdown</p>
            <div className="scroll-box">
              {breakdownText ? (
                <pre className="mono-pre">{breakdownText}</pre>
              ) : (
                <div className="empty-state">
                  <Clock size={28} />
                  <span>Run a test to see latency breakdown</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Calibration</h3>

          <div className="chip-row">
            {(
              [
                ["beep1k", "1kHz Beep"],
                ["beep200", "200Hz Low Beep"],
                ["beep2k", "Mixed (2kHz Sine)"],
                ["beep5k", "5kHz Beep"],
                ["impulse", "Click (Impulse)"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`chip-btn ${calibrationMode[key] ? "is-on" : ""}`.trim()}
                onClick={() =>
                  setCalibrationMode((prev) => ({ ...prev, [key]: !prev[key] }))
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="range-line mt-12">
            <span className="field-label">Repeats</span>
            <input
              className="skin-range"
              type="range"
              min={1}
              max={20}
              step={1}
              value={calibrationRepeats}
              onChange={(event) =>
                setCalibrationRepeats(
                  Math.round(toNumber(event.target.value, 5)),
                )
              }
            />
            <span>{calibrationRepeats}</span>
          </div>

          <div className="field-grid-2 mt-12">
            <button
              type="button"
              className="skin-btn secondary"
              disabled={running}
              onClick={() => {
                const selected = (
                  Object.entries(calibrationMode) as Array<
                    [
                      "beep200" | "beep1k" | "beep2k" | "beep5k" | "impulse",
                      boolean,
                    ]
                  >
                )
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

          <div className="mt-10">
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

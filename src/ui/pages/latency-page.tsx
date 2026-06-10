import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { fmtMs, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";
import { ChipGroup } from "../components/chip-group";
import { EmptyState } from "../components/empty-state";
import { ExportMenu } from "../components/export-menu";
import { CheckboxField, RangeField } from "../components/form-fields";
import { MetricCard, type MetricTier } from "../components/metric-card";
import { PageHeader } from "../components/page-header";
import { usePawdioLabContext } from "../pawdio-context";

function metricTier(ms: number | null | undefined): MetricTier | null {
  if (ms == null) return null;
  if (ms < 15) return "good";
  if (ms < 40) return "warn";
  return "bad";
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

  return (
    <div className="page-stack">
      <section className="page-card">
        <PageHeader
          title="Latency"
          description="Measure output-to-input delay with tone bursts and impulse clicks."
        />

        <section className="page-section">
          <h3 className="section-subheading">Run Delay Tests</h3>

          <ChipGroup
            options={presetOptions.map(({ key, label }) => ({
              key: key as PresetKey,
              label,
            }))}
            selected={runSelection}
            onToggle={(key) =>
              setRunSelection((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            ariaLabel="Latency test presets"
          />

          <RangeField
            className="mt-12"
            label="Repeats"
            min={1}
            max={20}
            step={1}
            value={request.repeats}
            onChange={(value) =>
              onChangeRequest({
                ...request,
                repeats: Math.max(1, Math.round(value)),
              })
            }
          />

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
                onChangeRequest({ ...request, saveOverallBarChart: checked })
              }
            />
          </div>

          <div className="field-grid-4 mt-12">
            <label className="field-row field-span-3">
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

          <div className="action-row">
            <div className="btn-row">
              <button
                type="button"
                className={`skin-btn${running ? " is-loading" : ""}`}
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
                Run All
              </button>
            </div>
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
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Results Summary</h3>

          <div className="metric-grid">
            <MetricCard
              label="Average (ms)"
              value={fmtMs(report?.averageDelayMs ?? null)}
              tier={metricTier(report?.averageDelayMs)}
            />
            <MetricCard
              label="Std Dev (ms)"
              value={fmtMs(report?.stdDevMs ?? null)}
              tier={metricTier(report?.stdDevMs)}
            />
            <MetricCard
              label="Last (ms)"
              value={fmtMs(lastDelay)}
              tier={metricTier(lastDelay)}
            />
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
                <EmptyState
                  icon={<Clock size={28} />}
                  message="Run a test to see latency breakdown"
                />
              )}
            </div>
          </div>
        </section>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Calibration</h3>

          <ChipGroup
            options={[
              { key: "beep1k", label: "1kHz Beep" },
              { key: "beep200", label: "200Hz Low Beep" },
              { key: "beep2k", label: "Mixed (2kHz Sine)" },
              { key: "beep5k", label: "5kHz Beep" },
              { key: "impulse", label: "Click (Impulse)" },
            ]}
            selected={calibrationMode}
            onToggle={(key) =>
              setCalibrationMode((prev) => ({ ...prev, [key]: !prev[key] }))
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
              Calibrate All Presets
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

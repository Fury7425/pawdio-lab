import { useMemo, useState } from "react";
import {
  ANC_MODE_META,
  ANC_MODE_ORDERED,
  type AncCaptures,
  type AncModeKey,
  type LibraryTestType,
  type MeasurementRecord,
  type TestPayload,
} from "../../model";
import {
  OverlayChart,
  type OverlaySeries,
} from "../../components/overlay-chart";
import { ChartLegend } from "../../components/chart-legend";
import { ExportMenu } from "../../components/export-menu";
import {
  computeVariationBand,
  normalizeCurveAt,
  smoothFractionalOctave,
  subtractReference,
  type FrequencyCurve,
} from "../../lib/curve-processing";
import {
  exportTimestampTag,
  rowsToCsv,
  type CsvValue,
} from "../../lib/export-files";
import { saveCsvFile, saveJsonFile } from "../../lib/save-text";
import { ancAttenuation, averageSides } from "../../lib/anc";
import type { CompareEntry } from "./comparison-panel";
import { usePawdioLabContext } from "../../pawdio-context";

export type Channel = "L" | "R" | "avg";

const SMOOTHING_OPTIONS = [48, 24, 12, 6, 3] as const;

function asNumArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}

const avgArrays = averageSides;

/** Auto-fit a padded dB range (rounded to 5) across all drawn curves. */
function autoRange(curves: number[][]): { yMin: number; yMax: number } {
  const values = curves.flat().filter((value) => Number.isFinite(value));
  if (values.length === 0) return { yMin: -40, yMax: 10 };
  let low = Math.min(...values);
  let high = Math.max(...values);
  const padding = Math.max(3, (high - low) * 0.1);
  low = Math.floor((low - padding) / 5) * 5;
  high = Math.ceil((high + padding) / 5) * 5;
  if (high - low < 10) high = low + 10;
  return { yMin: low, yMax: high };
}

export function sweepCurve(
  record: MeasurementRecord,
  channel: Channel,
): FrequencyCurve | null {
  const data = (record.payload as TestPayload).data as
    | Record<string, unknown>
    | undefined;
  const freqs = asNumArray(data?.freqs);
  const left = asNumArray(data?.left_mag_db_avg);
  const right = asNumArray(data?.right_mag_db_avg);
  const values =
    channel === "L" ? left : channel === "R" ? right : avgArrays(left, right);
  if (freqs.length < 2 || values.length < 2) return null;
  return { freqs, values };
}

function ancBaselineKey(captures: AncCaptures): AncModeKey | undefined {
  return ANC_MODE_ORDERED.find((mode) => captures[mode] !== undefined);
}

export function ancCurve(
  record: MeasurementRecord,
  channel: Channel,
  compareMode: AncModeKey | null,
): (FrequencyCurve & { modeLabel: string }) | null {
  const captures = record.payload as AncCaptures;
  const baselineKey = ancBaselineKey(captures);
  if (!baselineKey) return null;
  const baseline = captures[baselineKey];
  if (!baseline) return null;
  const modeKey =
    compareMode && compareMode !== baselineKey && captures[compareMode]
      ? compareMode
      : ANC_MODE_ORDERED.find(
          (mode) => mode !== baselineKey && captures[mode] !== undefined,
        );
  if (!modeKey) return null;
  const snapshot = captures[modeKey];
  if (!snapshot) return null;
  const attenuation = (side: "L" | "R") =>
    ancAttenuation(snapshot, baseline, side);
  const values =
    channel === "L"
      ? attenuation("L")
      : channel === "R"
        ? attenuation("R")
        : avgArrays(attenuation("L"), attenuation("R"));
  if (snapshot.freqs.length < 2 || values.length < 2) return null;
  return {
    freqs: snapshot.freqs,
    values,
    modeLabel: ANC_MODE_META[modeKey].label,
  };
}

type Props = {
  entries: CompareEntry[];
  kind: Extract<LibraryTestType, "sweep_fr" | "anc">;
  /** Index into `entries` of the curve that delta mode subtracts. */
  referenceIndex: number;
};

/** View channel: one curve per record, or both sides with R dashed. */
type ViewChannel = Channel | "LR";

const CHANNEL_OPTIONS: Array<{ key: ViewChannel; label: string }> = [
  { key: "avg", label: "Avg" },
  { key: "L", label: "L" },
  { key: "R", label: "R" },
  { key: "LR", label: "L + R" },
];

type PreparedSeries = OverlaySeries & { recordId: number; side: Channel };

/**
 * Compare saved frequency-domain measurements. Processing controls are
 * intentionally view-only: stored payloads always remain raw and unchanged.
 */
export function CompareCurves({ entries, kind, referenceIndex }: Props) {
  const ctx = usePawdioLabContext();
  const [channel, setChannel] = useState<ViewChannel>("avg");
  const [normalize, setNormalize] = useState(kind === "sweep_fr");
  const [compareMode, setCompareMode] = useState<AncModeKey | null>(null);
  const [smoothing, setSmoothing] = useState<number | null>(null);
  const [deltaMode, setDeltaMode] = useState(false);
  const [variationMode, setVariationMode] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const reference = entries[referenceIndex] ?? entries[0];
  const canDelta = entries.length > 1;
  const canVariation =
    kind === "sweep_fr" && entries.length > 1 && channel !== "LR";
  const showDelta = deltaMode && canDelta;
  const showVariation = variationMode && canVariation;

  const ancModeOptions = useMemo<AncModeKey[]>(() => {
    if (kind !== "anc") return [];
    const found = new Set<AncModeKey>();
    for (const { record } of entries) {
      const captures = record.payload as AncCaptures;
      const baselineKey = ancBaselineKey(captures);
      for (const mode of ANC_MODE_ORDERED) {
        if (mode !== baselineKey && captures[mode] !== undefined) {
          found.add(mode);
        }
      }
    }
    return ANC_MODE_ORDERED.filter((mode) => found.has(mode));
  }, [entries, kind]);

  const series = useMemo<OverlaySeries[]>(() => {
    const sides: Channel[] = channel === "LR" ? ["L", "R"] : [channel];
    const prepared: PreparedSeries[] = [];
    for (const { record, deviceName, color } of entries) {
      for (const side of sides) {
        const curve =
          kind === "sweep_fr"
            ? sweepCurve(record, side)
            : ancCurve(record, side, compareMode);
        if (!curve) continue;

        let processed: FrequencyCurve = curve;
        if (kind === "sweep_fr" && normalize) {
          processed = normalizeCurveAt(processed, 1000);
        }
        processed = smoothFractionalOctave(processed, smoothing);
        const name = record.label
          ? `${deviceName} · ${record.label}`
          : deviceName;
        const modeLabel =
          kind === "anc" && "modeLabel" in curve ? ` · ${curve.modeLabel}` : "";
        prepared.push({
          id: channel === "LR" ? `${record.id}-${side}` : String(record.id),
          recordId: record.id,
          side,
          label: `${name}${modeLabel}${channel === "LR" ? ` (${side})` : ""}`,
          color,
          dash: channel === "LR" && side === "R" ? "2.5 2" : undefined,
          freqs: processed.freqs,
          values: processed.values,
        });
      }
    }

    if (showVariation) {
      const variation = computeVariationBand(prepared);
      if (!variation) return [];
      return [
        {
          id: "variation-band",
          label: `Variation (${prepared.length}) · median`,
          color: "var(--accent-strong)",
          freqs: variation.freqs,
          values: variation.median,
          band: {
            outerLow: variation.p10,
            outerHigh: variation.p90,
            innerLow: variation.p25,
            innerHigh: variation.p75,
          },
        },
      ];
    }

    if (showDelta && reference) {
      const refId = reference.record.id;
      const out: OverlaySeries[] = [];
      for (const item of prepared) {
        if (item.recordId === refId) continue;
        const base = prepared.find(
          (p) => p.recordId === refId && p.side === item.side,
        );
        if (!base) continue;
        const delta = subtractReference(item, base);
        out.push({
          id: item.id,
          label: `${item.label} vs ref`,
          color: item.color,
          dash: item.dash,
          freqs: delta.freqs,
          values: delta.values,
        });
      }
      return out;
    }

    return prepared;
  }, [
    entries,
    kind,
    channel,
    normalize,
    compareMode,
    smoothing,
    showDelta,
    showVariation,
    reference,
  ]);

  const visibleSeries = useMemo(
    () => series.filter((item) => !hidden.has(item.id)),
    [series, hidden],
  );

  function toggleHidden(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { yMin, yMax } = useMemo(
    () =>
      autoRange(
        visibleSeries.flatMap((item) => [
          item.values,
          ...(item.band
            ? [
                item.band.outerLow,
                item.band.outerHigh,
                item.band.innerLow,
                item.band.innerHigh,
              ]
            : []),
        ]),
      ),
    [visibleSeries],
  );

  const viewMode = showVariation
    ? "variation"
    : showDelta
      ? "delta"
      : "overlay";

  function exportViewJson() {
    return saveJsonFile(
      `${kind}_comparison_${viewMode}_${exportTimestampTag()}.json`,
      {
        format: "pawdio-lab-comparison-view",
        version: 1,
        generatedAt: new Date().toISOString(),
        testType: kind,
        transforms: {
          channel,
          viewMode,
          normalizedAtHz: kind === "sweep_fr" && normalize ? 1000 : null,
          smoothingFraction: smoothing,
          ancMode: kind === "anc" ? compareMode : null,
          reference:
            showDelta && reference
              ? {
                  recordId: reference.record.id,
                  deviceName: reference.deviceName,
                }
              : null,
          variationPercentiles: showVariation
            ? { outer: [10, 90], inner: [25, 75], center: 50 }
            : null,
        },
        series: visibleSeries,
      },
    );
  }

  function exportViewCsv() {
    const rows: CsvValue[][] = [];
    for (const item of visibleSeries) {
      const length = Math.min(item.freqs.length, item.values.length);
      for (let index = 0; index < length; index += 1) {
        rows.push([
          item.id,
          item.label,
          kind,
          channel,
          viewMode,
          smoothing,
          kind === "sweep_fr" && normalize ? 1000 : null,
          item.freqs[index],
          item.values[index],
          item.band?.outerLow[index] ?? null,
          item.band?.innerLow[index] ?? null,
          item.band?.innerHigh[index] ?? null,
          item.band?.outerHigh[index] ?? null,
        ]);
      }
    }
    return saveCsvFile(
      `${kind}_comparison_${viewMode}_${exportTimestampTag()}.csv`,
      rowsToCsv(
        [
          "SeriesId",
          "SeriesLabel",
          "TestType",
          "Channel",
          "ViewMode",
          "SmoothingFraction",
          "NormalizedAtHz",
          "Frequency(Hz)",
          "Value(dB)",
          "P10(dB)",
          "P25(dB)",
          "P75(dB)",
          "P90(dB)",
        ],
        rows,
      ),
    );
  }

  return (
    <div>
      <div className="graph-controls-row compare-controls">
        <span
          className="channel-selector"
          role="group"
          aria-label="Select channel"
        >
          {CHANNEL_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`channel-btn${channel === option.key ? " is-active" : ""}`}
              aria-pressed={channel === option.key}
              onClick={() => setChannel(option.key)}
            >
              {option.label}
            </button>
          ))}
        </span>

        <label className="chart-control-field">
          <span className="muted">Smoothing</span>
          <select
            className="skin-select compact"
            value={smoothing ?? ""}
            onChange={(event) =>
              setSmoothing(
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          >
            <option value="">Off</option>
            {SMOOTHING_OPTIONS.map((fraction) => (
              <option key={fraction} value={fraction}>
                1/{fraction} octave
              </option>
            ))}
          </select>
        </label>

        {kind === "anc" && ancModeOptions.length > 0 && (
          <label className="chart-control-field">
            <span className="muted">Mode</span>
            <select
              className="skin-select compact"
              value={compareMode ?? ""}
              onChange={(event) =>
                setCompareMode((event.target.value as AncModeKey) || null)
              }
            >
              <option value="">Auto (first vs baseline)</option>
              {ancModeOptions.map((mode) => (
                <option key={mode} value={mode}>
                  {ANC_MODE_META[mode].label}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === "sweep_fr" && (
          <button
            type="button"
            className={`chip-btn${normalize ? " is-on" : ""}`}
            aria-pressed={normalize}
            onClick={() => setNormalize((value) => !value)}
            title="Align each curve to 0 dB at 1 kHz"
          >
            Normalize @ 1kHz
          </button>
        )}

        <button
          type="button"
          className={`chip-btn${showDelta ? " is-on" : ""}`}
          aria-pressed={showDelta}
          disabled={!canDelta}
          title="Subtract the reference measurement from every other curve"
          onClick={() => {
            setDeltaMode((value) => !value);
            setVariationMode(false);
          }}
        >
          Delta vs ref
        </button>

        {kind === "sweep_fr" && (
          <button
            type="button"
            className={`chip-btn${showVariation ? " is-on" : ""}`}
            aria-pressed={showVariation}
            disabled={!canVariation}
            title="Replace individual curves with percentile variation bands"
            onClick={() => {
              setVariationMode((value) => !value);
              setDeltaMode(false);
            }}
          >
            Variation band
          </button>
        )}

        <span className="compare-controls-end">
          <ExportMenu
            label="Export view"
            disabled={visibleSeries.length === 0}
            items={[
              {
                label: "Export JSON",
                onSelect: () => ctx.run(exportViewJson()),
              },
              {
                label: "Export CSV",
                onSelect: () => ctx.run(exportViewCsv()),
              },
            ]}
          />
        </span>
      </div>

      <ChartLegend items={series} hiddenIds={hidden} onToggle={toggleHidden} />

      <div className="level-meter compare-chart">
        <OverlayChart
          series={visibleSeries}
          yMin={yMin}
          yMax={yMax}
          yAxisLabel="dB"
          ariaLabel={
            kind === "sweep_fr"
              ? "Frequency response comparison"
              : "ANC attenuation comparison"
          }
          emptyMessage={
            series.length > 0
              ? "Every curve is hidden. Click a legend entry to show it."
              : "No comparable curve data in the selected records"
          }
        />
      </div>

      {showDelta && reference && series.length > 0 && (
        <p className="chart-mode-note">
          Reference: {reference.deviceName}
          {reference.record.label ? ` · ${reference.record.label}` : ""}.
          Positive values are above the reference curve.
        </p>
      )}
      {showVariation && series.length > 0 && (
        <p className="chart-mode-note">
          Outer band: p10–p90 · inner band: p25–p75 · line: median. Saved data
          is unchanged.
        </p>
      )}
      {!showDelta && !showVariation && series.length > 1 && (
        <p className="chart-mode-note">
          Click a legend entry to hide or show that curve.
        </p>
      )}
    </div>
  );
}

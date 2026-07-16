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
  downloadCsv,
  downloadJson,
  exportTimestampTag,
  rowsToCsv,
  type CsvValue,
} from "../../lib/export-files";
import type { CompareEntry } from "./comparison-panel";

type Channel = "L" | "R" | "avg";

const SMOOTHING_OPTIONS = [48, 24, 12, 6, 3] as const;

function asNumArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}

function avgArrays(left: number[], right: number[]): number[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const length = Math.min(left.length, right.length);
  return Array.from(
    { length },
    (_, index) => (left[index] + right[index]) / 2,
  );
}

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

function sweepCurve(
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

function ancCurve(
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
  const attenuation = (side: "L" | "R") => {
    const before =
      side === "L" ? baseline.magDbLeft : baseline.magDbRight;
    const after =
      side === "L" ? snapshot.magDbLeft : snapshot.magDbRight;
    return after.map((value, index) => value - (before[index] ?? NaN));
  };
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
};

/**
 * Compare saved frequency-domain measurements. Processing controls are
 * intentionally view-only: stored payloads always remain raw and unchanged.
 */
export function CompareCurves({ entries, kind }: Props) {
  const [channel, setChannel] = useState<Channel>("avg");
  const [normalize, setNormalize] = useState(kind === "sweep_fr");
  const [compareMode, setCompareMode] = useState<AncModeKey | null>(null);
  const [smoothing, setSmoothing] = useState<number | null>(null);
  const [deltaMode, setDeltaMode] = useState(false);
  const [variationMode, setVariationMode] = useState(false);

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
    const prepared: OverlaySeries[] = [];
    for (const { record, deviceName, color } of entries) {
      const curve =
        kind === "sweep_fr"
          ? sweepCurve(record, channel)
          : ancCurve(record, channel, compareMode);
      if (!curve) continue;

      let processed: FrequencyCurve = curve;
      if (kind === "sweep_fr" && normalize) {
        processed = normalizeCurveAt(processed, 1000);
      }
      processed = smoothFractionalOctave(processed, smoothing);
      const label =
        kind === "anc" && "modeLabel" in curve
          ? `${deviceName} · ${curve.modeLabel}`
          : deviceName;
      prepared.push({
        id: String(record.id),
        label,
        color,
        freqs: processed.freqs,
        values: processed.values,
      });
    }

    if (variationMode && kind === "sweep_fr") {
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

    if (deltaMode && prepared.length > 1) {
      const reference = prepared[0];
      return prepared.slice(1).map((item) => {
        const delta = subtractReference(item, reference);
        return {
          ...item,
          label: `${item.label} − ${reference.label}`,
          freqs: delta.freqs,
          values: delta.values,
        };
      });
    }

    return prepared;
  }, [
    entries,
    kind,
    channel,
    normalize,
    compareMode,
    smoothing,
    deltaMode,
    variationMode,
  ]);

  const { yMin, yMax } = useMemo(
    () =>
      autoRange(
        series.flatMap((item) => [
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
    [series],
  );

  const viewMode = variationMode
    ? "variation"
    : deltaMode
      ? "delta"
      : "overlay";

  function exportViewJson() {
    downloadJson(
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
            deltaMode && entries[0]
              ? {
                  recordId: entries[0].record.id,
                  deviceName: entries[0].deviceName,
                }
              : null,
          variationPercentiles: variationMode
            ? { outer: [10, 90], inner: [25, 75], center: 50 }
            : null,
        },
        series,
      },
    );
  }

  function exportViewCsv() {
    const rows: CsvValue[][] = [];
    for (const item of series) {
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
    downloadCsv(
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
      <div className="graph-controls-row" style={{ marginBottom: 12 }}>
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

        <button
          type="button"
          className={`chip-btn${deltaMode ? " is-on" : ""}`}
          aria-pressed={deltaMode}
          disabled={entries.length < 2}
          title="Subtract the first selected measurement from every other curve"
          onClick={() => {
            setDeltaMode((value) => !value);
            setVariationMode(false);
          }}
        >
          Delta vs first
        </button>

        {kind === "sweep_fr" && (
          <button
            type="button"
            className={`chip-btn${variationMode ? " is-on" : ""}`}
            aria-pressed={variationMode}
            disabled={entries.length < 2}
            title="Replace individual curves with percentile variation bands"
            onClick={() => {
              setVariationMode((value) => !value);
              setDeltaMode(false);
            }}
          >
            Variation band
          </button>
        )}

        <ExportMenu
          label="Export View"
          disabled={series.length === 0}
          items={[
            { label: "Export JSON", onSelect: exportViewJson },
            { label: "Export CSV", onSelect: exportViewCsv },
          ]}
        />

        <span
          className="channel-selector"
          role="group"
          aria-label="Select channel"
        >
          {(["L", "R", "avg"] as Channel[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`channel-btn${channel === option ? " is-active" : ""}`}
              aria-pressed={channel === option}
              onClick={() => setChannel(option)}
            >
              {option === "avg" ? "Avg" : option}
            </button>
          ))}
        </span>

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
      </div>

      {deltaMode && series.length > 0 && (
        <p className="chart-mode-note">
          Reference: first selected measurement. Positive values are above the
          reference curve.
        </p>
      )}
      {variationMode && series.length > 0 && (
        <p className="chart-mode-note">
          Outer band: p10–p90 · inner band: p25–p75 · line: median. Saved data
          is unchanged.
        </p>
      )}

      <ChartLegend items={series} />

      <div className="level-meter" style={{ marginBottom: 12 }}>
        <OverlayChart
          series={series}
          yMin={yMin}
          yMax={yMax}
          yAxisLabel="dB"
          ariaLabel={
            kind === "sweep_fr"
              ? "Frequency response comparison"
              : "ANC attenuation comparison"
          }
          emptyMessage="No comparable curve data in the selected records"
        />
      </div>
    </div>
  );
}

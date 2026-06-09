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
import { nearestFreqIndex } from "../../lib/chart-scale";
import type { CompareEntry } from "./comparison-panel";

type Channel = "L" | "R" | "avg";

function asNumArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((x): x is number => typeof x === "number")
    : [];
}

function avgArrays(left: number[], right: number[]): number[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const n = Math.min(left.length, right.length);
  return Array.from({ length: n }, (_, i) => (left[i] + right[i]) / 2);
}

/** Auto-fit a padded dB range (rounded to 5) across all drawn curves. */
function autoRange(curves: number[][]): { yMin: number; yMax: number } {
  const all = curves.flat().filter((v) => Number.isFinite(v));
  if (all.length === 0) return { yMin: -40, yMax: 10 };
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = Math.max(3, (hi - lo) * 0.1);
  lo = Math.floor((lo - pad) / 5) * 5;
  hi = Math.ceil((hi + pad) / 5) * 5;
  if (hi - lo < 10) hi = lo + 10;
  return { yMin: lo, yMax: hi };
}

function sweepCurve(
  rec: MeasurementRecord,
  channel: Channel,
): {
  freqs: number[];
  values: number[];
} | null {
  const data = (rec.payload as TestPayload).data as
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
  return ANC_MODE_ORDERED.find((m) => captures[m] !== undefined);
}

function ancCurve(
  rec: MeasurementRecord,
  channel: Channel,
  compareMode: AncModeKey | null,
): { freqs: number[]; values: number[]; modeLabel: string } | null {
  const captures = rec.payload as AncCaptures;
  const baselineKey = ancBaselineKey(captures);
  if (!baselineKey) return null;
  const baseline = captures[baselineKey];
  if (!baseline) return null;
  const modeKey =
    compareMode && compareMode !== baselineKey && captures[compareMode]
      ? compareMode
      : ANC_MODE_ORDERED.find(
          (m) => m !== baselineKey && captures[m] !== undefined,
        );
  if (!modeKey) return null;
  const snap = captures[modeKey];
  if (!snap) return null;
  const atten = (side: "L" | "R") => {
    const b = side === "L" ? baseline.magDbLeft : baseline.magDbRight;
    const a = side === "L" ? snap.magDbLeft : snap.magDbRight;
    return a.map((v, i) => v - (b[i] ?? NaN));
  };
  const values =
    channel === "L"
      ? atten("L")
      : channel === "R"
        ? atten("R")
        : avgArrays(atten("L"), atten("R"));
  if (snap.freqs.length < 2 || values.length < 2) return null;
  return { freqs: snap.freqs, values, modeLabel: ANC_MODE_META[modeKey].label };
}

type Props = {
  entries: CompareEntry[];
  kind: Extract<LibraryTestType, "sweep_fr" | "anc">;
};

/**
 * Overlay multiple devices' frequency-response (sweep_fr) or ANC attenuation
 * curves on the shared OverlayChart. Sweep curves can be normalized to 0 dB at
 * 1 kHz so shape is compared independent of absolute gain.
 */
export function CompareCurves({ entries, kind }: Props) {
  const [channel, setChannel] = useState<Channel>("avg");
  const [normalize, setNormalize] = useState(kind === "sweep_fr");
  const [compareMode, setCompareMode] = useState<AncModeKey | null>(null);

  // Non-baseline ANC modes present across all selected records (for the picker).
  const ancModeOptions = useMemo<AncModeKey[]>(() => {
    if (kind !== "anc") return [];
    const found = new Set<AncModeKey>();
    for (const { record } of entries) {
      const captures = record.payload as AncCaptures;
      const baselineKey = ancBaselineKey(captures);
      for (const m of ANC_MODE_ORDERED) {
        if (m !== baselineKey && captures[m] !== undefined) found.add(m);
      }
    }
    return ANC_MODE_ORDERED.filter((m) => found.has(m));
  }, [entries, kind]);

  const series = useMemo<OverlaySeries[]>(() => {
    const out: OverlaySeries[] = [];
    for (const { record, deviceName, color } of entries) {
      const curve =
        kind === "sweep_fr"
          ? sweepCurve(record, channel)
          : ancCurve(record, channel, compareMode);
      if (!curve) continue;
      let values = curve.values;
      if (kind === "sweep_fr" && normalize) {
        const refIdx = nearestFreqIndex(curve.freqs, 1000);
        const ref = refIdx >= 0 ? values[refIdx] : 0;
        if (Number.isFinite(ref)) values = values.map((v) => v - ref);
      }
      const label =
        kind === "anc" && "modeLabel" in curve
          ? `${deviceName} · ${curve.modeLabel}`
          : deviceName;
      out.push({
        id: String(record.id),
        label,
        color,
        freqs: curve.freqs,
        values,
      });
    }
    return out;
  }, [entries, kind, channel, normalize, compareMode]);

  const { yMin, yMax } = useMemo(
    () => autoRange(series.map((s) => s.values)),
    [series],
  );

  const unit = "dB";

  return (
    <div>
      <div className="graph-controls-row" style={{ marginBottom: 12 }}>
        <span
          className="channel-selector"
          role="group"
          aria-label="Select channel"
        >
          {(["L", "R", "avg"] as Channel[]).map((ch) => (
            <button
              key={ch}
              type="button"
              className={`channel-btn${channel === ch ? " is-active" : ""}`}
              aria-pressed={channel === ch}
              onClick={() => setChannel(ch)}
            >
              {ch === "avg" ? "Avg" : ch}
            </button>
          ))}
        </span>

        {kind === "sweep_fr" && (
          <button
            type="button"
            className={`chip-btn${normalize ? " is-on" : ""}`}
            aria-pressed={normalize}
            onClick={() => setNormalize((v) => !v)}
            title="Align each curve to 0 dB at 1 kHz"
          >
            Normalize @ 1kHz
          </button>
        )}

        {kind === "anc" && ancModeOptions.length > 0 && (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
            }}
          >
            <span className="muted">Mode:</span>
            <select
              className="skin-select"
              style={{ padding: "4px 8px", fontSize: 11 }}
              value={compareMode ?? ""}
              onChange={(e) =>
                setCompareMode((e.target.value as AncModeKey) || null)
              }
            >
              <option value="">Auto (first vs baseline)</option>
              {ancModeOptions.map((m) => (
                <option key={m} value={m}>
                  {ANC_MODE_META[m].label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <ChartLegend items={series} />

      <div className="level-meter" style={{ marginBottom: 12 }}>
        <OverlayChart
          series={series}
          yMin={yMin}
          yMax={yMax}
          yAxisLabel={unit}
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

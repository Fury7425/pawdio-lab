import { useMemo } from "react";
import { AudioWaveform } from "lucide-react";
import type { TestPayload } from "../model";
import { boundsFromCurves } from "../lib/compensation";
import { processBounds, processCurve, viewSummary } from "../lib/curve-view";
import type { CurveViewOptions } from "../lib/curve-view";
import { sweepNumberList } from "../lib/sweep-results";
import type { CurveViewController } from "../hooks/use-curve-view";
import { ChartLegend } from "./chart-legend";
import { EmptyState } from "./empty-state";
import { OverlayChart, type OverlaySeries } from "./overlay-chart";

type Props = {
  result: TestPayload | null;
  compact?: boolean;
  status?: "pending" | "accepted" | "rejected" | "final" | null;
  /**
   * Display processing. Without it the view falls back to the plain
   * normalised-at-1 kHz rendering it has always used.
   */
  curveView?: CurveViewController;
};

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The processing to apply when the caller supplied no controller. */
const FALLBACK_VIEW: CurveViewOptions = {
  smoothing: null,
  normalize: true,
  normalizeHz: 1000,
  compensation: null,
  showPopulationBand: false,
};

function autoRange(series: OverlaySeries[]): { yMin: number; yMax: number } {
  const values = series
    .flatMap((item) => item.values)
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return { yMin: -30, yMax: 15 };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(4, (high - low) * 0.1);
  let yMin = Math.floor((low - padding) / 5) * 5;
  let yMax = Math.ceil((high + padding) / 5) * 5;
  if (yMax - yMin < 20) {
    yMin -= 5;
    yMax += 5;
  }
  return { yMin, yMax };
}

export function SweepResultView({
  result,
  compact = false,
  status = null,
  curveView,
}: Props) {
  const options = useMemo<CurveViewOptions>(() => {
    if (!curveView) return FALLBACK_VIEW;
    return {
      smoothing: curveView.view.smoothing,
      normalize: curveView.view.normalize,
      normalizeHz: curveView.view.normalizeHz,
      compensation: curveView.compensation,
      showPopulationBand: curveView.view.showPopulationBand,
    };
  }, [curveView]);

  const series = useMemo<OverlaySeries[]>(() => {
    if (!result) return [];
    const data = recordOrEmpty(result.data);
    const freqs = sweepNumberList(data.freqs);
    const left = sweepNumberList(data.left_mag_db_avg);
    const right = sweepNumberList(data.right_mag_db_avg);
    const next: OverlaySeries[] = [];

    const build = (
      id: string,
      label: string,
      color: string,
      values: number[],
      dash?: string,
    ) => {
      const processed = processCurve({ freqs, values }, options);
      if (processed.freqs.length < 2) return;
      next.push({
        id,
        label,
        color,
        dash,
        freqs: processed.freqs,
        values: processed.values,
        band: processed.band,
      });
    };

    if (freqs.length > 1 && left.length > 1) {
      build("sweep-left", "Left", "var(--accent-strong)", left);
    }
    if (freqs.length > 1 && right.length > 1) {
      build("sweep-right", "Right", "hsl(175, 65%, 45%)", right, "3 2");
    }

    // Preference bounds ride on the same axes, shaped the same way, so the
    // curve can be read against them without mental arithmetic.
    const upper = curveView?.boundsUpper;
    const lower = curveView?.boundsLower;
    if (curveView?.view.showBounds && upper && lower) {
      const bounds = processBounds(boundsFromCurves(upper, lower), options);
      next.push({
        id: "bounds-upper",
        label: "Upper bound",
        color: "var(--text-muted)",
        dash: "6 4",
        freqs: bounds.upper.freqs,
        values: bounds.upper.values,
      });
      next.push({
        id: "bounds-lower",
        label: "Lower bound",
        color: "var(--text-muted)",
        dash: "6 4",
        freqs: bounds.lower.freqs,
        values: bounds.lower.values,
      });
    }
    return next;
  }, [result, options, curveView]);
  const { yMin, yMax } = useMemo(() => autoRange(series), [series]);

  if (!result || series.length === 0) {
    return (
      <EmptyState
        icon={<AudioWaveform size={32} />}
        message="Run a sweep to see the latest result"
        hint="Each completed capture appears here before it is accepted."
        style={{ minHeight: compact ? 180 : 420 }}
      />
    );
  }

  const params = recordOrEmpty(result.params);
  const metrics = recordOrEmpty(result.metrics);
  const accepted = Number(params.accepted_repeats);
  const attempts = Number(params.total_attempts);
  const statusLabel =
    status === "pending"
      ? "Awaiting decision"
      : status === "rejected"
        ? "Discarded - not counted"
        : status === "accepted"
          ? "Accepted capture"
          : status === "final"
            ? `${accepted} accepted${
                Number.isFinite(attempts) ? ` / ${attempts} attempts` : ""
              }`
            : null;

  return (
    <div className={compact ? "sweep-result compact" : "sweep-result"}>
      <div className="result-header sweep-result-header">
        <div>
          <h4>Most Recent Sweep</h4>
          <time>{result.timestamp}</time>
        </div>
        {!compact && statusLabel && (
          <span
            className={`status-badge${
              status === "rejected"
                ? " is-danger"
                : status === "pending"
                  ? ""
                  : " is-success"
            }`}
          >
            {statusLabel}
          </span>
        )}
      </div>

      <ChartLegend items={series} />
      <p className="muted compact-note">{viewSummary(options)}</p>
      {typeof metrics.mirrored_channel === "string" && (
        <p className="field-error compact-note">
          The {metrics.mirrored_channel} channel recorded silence, so both
          curves come from one microphone. Check the mic if this was meant to be
          a stereo capture.
        </p>
      )}
      <div className="sweep-result-chart">
        <OverlayChart
          series={series}
          yMin={yMin}
          yMax={yMax}
          yAxisLabel="dB"
          ariaLabel="Most recent frequency response sweep"
        />
      </div>

      {!compact && (
        <div className="sweep-result-summary">
          <article className="metric-card">
            <p className="metric-label">Left delay</p>
            <p className="metric-value">
              {typeof metrics.delay_ms_left === "number"
                ? `${metrics.delay_ms_left.toFixed(2)} ms`
                : "-"}
            </p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Right delay</p>
            <p className="metric-value">
              {typeof metrics.delay_ms_right === "number"
                ? `${metrics.delay_ms_right.toFixed(2)} ms`
                : "-"}
            </p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Capture</p>
            <p className="metric-value sweep-result-mode">
              {String(params.capture_order ?? params.mono_side ?? "stereo")}
            </p>
          </article>
        </div>
      )}

      {!compact && <AlignmentReport metrics={metrics} />}
    </div>
  );
}

type AlignmentMetrics = {
  startConfidence?: unknown;
  startSeparation?: unknown;
  endMarkerConfidence?: unknown;
  driftRatio?: unknown;
  timingErrorMs?: unknown;
  snrDb?: unknown;
  bluetoothMode?: unknown;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Timing numbers from a marker-locked capture. Only wireless captures produce
 * these, so the block is absent on a wired measurement rather than showing
 * placeholders.
 */
function AlignmentReport({ metrics }: { metrics: Record<string, unknown> }) {
  const alignment = metrics.alignment;
  if (!alignment || typeof alignment !== "object") return null;
  const data = alignment as AlignmentMetrics;

  const drift = asNumber(data.driftRatio);
  const rows: { label: string; value: string }[] = [];

  const startConfidence = asNumber(data.startConfidence);
  if (startConfidence !== null) {
    rows.push({
      label: "Start lock",
      value: `${startConfidence.toFixed(1)}x`,
    });
  }
  const separation = asNumber(data.startSeparation);
  if (separation !== null && Number.isFinite(separation)) {
    rows.push({ label: "Peak margin", value: `${separation.toFixed(1)}x` });
  }
  const endConfidence = asNumber(data.endMarkerConfidence);
  if (endConfidence !== null) {
    rows.push({ label: "End lock", value: `${endConfidence.toFixed(1)}x` });
  }
  if (drift !== null) {
    rows.push({
      label: "Clock drift",
      value: `${((drift - 1) * 1e6).toFixed(0)} ppm`,
    });
  }
  const timingError = asNumber(data.timingErrorMs);
  if (timingError !== null) {
    rows.push({ label: "Timing error", value: `${timingError.toFixed(2)} ms` });
  }
  const snr = asNumber(data.snrDb);
  if (snr !== null) {
    rows.push({ label: "Capture SNR", value: `${snr.toFixed(1)} dB` });
  }
  if (rows.length === 0) return null;

  return (
    <section className="page-section">
      <h4 className="section-subheading">Wireless alignment</h4>
      <dl className="diagnostic-grid">
        {rows.map((row) => (
          <div className="diagnostic-cell" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

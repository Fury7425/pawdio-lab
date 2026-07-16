import { useMemo } from "react";
import { AudioWaveform } from "lucide-react";
import type { TestPayload } from "../model";
import { nearestFreqIndex } from "../lib/chart-scale";
import { sweepNumberList } from "../lib/sweep-results";
import { ChartLegend } from "./chart-legend";
import { EmptyState } from "./empty-state";
import { OverlayChart, type OverlaySeries } from "./overlay-chart";

type Props = {
  result: TestPayload | null;
  compact?: boolean;
  status?: "pending" | "accepted" | "rejected" | "final" | null;
};

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeAtOneKhz(freqs: number[], values: number[]): number[] {
  const length = Math.min(freqs.length, values.length);
  if (length === 0) return [];
  const index = nearestFreqIndex(freqs.slice(0, length), 1000);
  const reference = index >= 0 ? values[index] : 0;
  return values.slice(0, length).map((value) => value - reference);
}

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
}: Props) {
  const series = useMemo<OverlaySeries[]>(() => {
    if (!result) return [];
    const data = recordOrEmpty(result.data);
    const freqs = sweepNumberList(data.freqs);
    const left = sweepNumberList(data.left_mag_db_avg);
    const right = sweepNumberList(data.right_mag_db_avg);
    const next: OverlaySeries[] = [];
    if (freqs.length > 1 && left.length > 1) {
      next.push({
        id: "sweep-left",
        label: "Left",
        color: "var(--accent-strong)",
        freqs,
        values: normalizeAtOneKhz(freqs, left),
      });
    }
    if (freqs.length > 1 && right.length > 1) {
      next.push({
        id: "sweep-right",
        label: "Right",
        color: "hsl(175, 65%, 45%)",
        dash: "3 2",
        freqs,
        values: normalizeAtOneKhz(freqs, right),
      });
    }
    return next;
  }, [result]);
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
      <div className="sweep-result-chart">
        <OverlayChart
          series={series}
          yMin={yMin}
          yMax={yMax}
          yAxisLabel="dB"
          ariaLabel="Most recent frequency response sweep"
          tooltip={!compact}
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
    </div>
  );
}

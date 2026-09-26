import type { MeasurementRecord } from "../../model";
import type { CompareEntry } from "./comparison-panel";

type LatencySummary = {
  avg: number | null;
  std: number | null;
  measurements: Array<{ delayMs: number | null }>;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Latency is saved in two shapes: the latest-run `LatencyReport`
 * (`averageDelayMs`, …) and the results-list `TestPayload`
 * (`metrics.average_delay_ms`, `data.measurements`). Read either.
 */
export function latencySummary(
  payload: MeasurementRecord["payload"],
): LatencySummary {
  const record = payload as unknown as Record<string, unknown>;
  const metrics = record.metrics as Record<string, unknown> | undefined;
  const data = record.data as Record<string, unknown> | undefined;
  const rawMeasurements = Array.isArray(record.measurements)
    ? record.measurements
    : Array.isArray(data?.measurements)
      ? data.measurements
      : [];
  const measurements = rawMeasurements.map((item) => ({
    delayMs: num((item as Record<string, unknown>)?.delayMs),
  }));
  return {
    avg: num(record.averageDelayMs) ?? num(metrics?.average_delay_ms),
    std: num(record.stdDevMs) ?? num(metrics?.std_dev_ms),
    measurements,
  };
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toFixed(2);
}

/**
 * Latency comparison: one metric card per device showing average delay, std
 * dev, sample count, and delta vs the first selected device. The lowest
 * average is highlighted as best.
 */
export function CompareLatency({ entries }: { entries: CompareEntry[] }) {
  const rows = entries.map(({ record, deviceName, color }) => {
    const summary = latencySummary(record.payload);
    return {
      id: record.id,
      deviceName,
      color,
      avg: summary.avg,
      std: summary.std,
      n: summary.measurements.filter((m) => m.delayMs !== null).length,
    };
  });

  const finiteAvgs = rows
    .map((r) => r.avg)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const bestAvg = finiteAvgs.length ? Math.min(...finiteAvgs) : null;
  const firstAvg = rows[0]?.avg ?? null;

  return (
    <div className="metric-grid">
      {rows.map((row) => {
        const isBest = bestAvg !== null && row.avg === bestAvg;
        const delta =
          row.avg !== null &&
          firstAvg !== null &&
          Number.isFinite(row.avg) &&
          Number.isFinite(firstAvg)
            ? row.avg - firstAvg
            : null;
        return (
          <article
            key={row.id}
            className={`metric-card${isBest ? " metric-good" : ""}`}
            style={{
              borderColor: `color-mix(in srgb, ${row.color} 40%, transparent)`,
            }}
          >
            <p className="metric-label" style={{ color: row.color }}>
              {row.deviceName}
            </p>
            <p className="metric-value">
              {fmt(row.avg)}
              <span style={{ fontSize: 12, fontWeight: 400 }}> ms</span>
            </p>
            <p
              className="metric-label"
              style={{ marginTop: 4, marginBottom: 0 }}
            >
              ± {fmt(row.std)} ms · n={row.n}
              {delta !== null && delta !== 0 && (
                <span>
                  {" · Δ "}
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(2)} ms
                </span>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}

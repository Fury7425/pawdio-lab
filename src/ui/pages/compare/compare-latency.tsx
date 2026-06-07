import { type LatencyReport } from "../../model";
import type { CompareEntry } from "./comparison-panel";

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
    const report = record.payload as LatencyReport;
    const n =
      report.measurements?.filter((m) => m.delayMs !== null).length ?? 0;
    return {
      id: record.id,
      deviceName,
      color,
      avg: report.averageDelayMs ?? null,
      std: report.stdDevMs ?? null,
      n,
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
            style={{ borderLeft: `3px solid ${row.color}` }}
          >
            <p className="metric-label">{row.deviceName}</p>
            <p className="metric-value">
              {fmt(row.avg)}
              <span style={{ fontSize: 12, fontWeight: 400 }}> ms</span>
            </p>
            <p className="metric-label" style={{ marginTop: 4, marginBottom: 0 }}>
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

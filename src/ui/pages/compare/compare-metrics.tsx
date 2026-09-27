import { fmtHz } from "../../lib/chart-scale";
import {
  balanceStats,
  bestIndex,
  crosstalkStats,
  formatCaptured,
  latencyStats,
  thdPoints,
  type Better,
} from "../../lib/library";
import type { CompareEntry } from "./comparison-panel";

export type MetricRow = {
  key: string;
  label: string;
  unit?: string;
  values: Array<number | null>;
  /** Shown instead of `values` for descriptive rows such as a direction. */
  texts?: Array<string | null>;
  digits?: number;
  /** Which value wins the row. Omit for context rows (tone, sample count). */
  better?: Better;
};

type ViewProps = { entries: CompareEntry[]; referenceIndex: number };

function fmt(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toFixed(digits);
}

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/** Note shown when the records were measured at different test tones. */
function toneMismatch(freqs: Array<number | null>): string | null {
  const distinct = new Set(freqs.filter((f): f is number => f !== null));
  return distinct.size > 1
    ? "These records use different test tones, so the numbers are not a like-for-like comparison."
    : null;
}

/**
 * One column per selected record, one row per metric. The winning value in
 * each row is highlighted and every other column shows its difference from
 * the reference column.
 */
export function CompareTable({
  entries,
  rows,
  referenceIndex,
  note,
}: ViewProps & { rows: MetricRow[]; note?: string | null }) {
  const multi = entries.length > 1;
  return (
    <div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col" className="compare-metric-col">
                Metric
              </th>
              {entries.map(({ record, deviceName, color }, index) => (
                <th scope="col" key={record.id}>
                  <span className="compare-col-head">
                    <span
                      className="chart-swatch"
                      aria-hidden="true"
                      style={{ background: color }}
                    />
                    <span className="compare-col-name">{deviceName}</span>
                    {multi && index === referenceIndex && (
                      <span className="compare-ref-tag">Ref</span>
                    )}
                  </span>
                  <span className="compare-col-sub">
                    {record.label || formatCaptured(record.capturedAt)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const digits = row.digits ?? 2;
              const best = row.better ? bestIndex(row.values, row.better) : -1;
              const reference = row.values[referenceIndex];
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((value, index) => {
                    const text = row.texts?.[index];
                    const delta =
                      multi &&
                      row.better &&
                      index !== referenceIndex &&
                      value !== null &&
                      reference !== null
                        ? value - reference
                        : null;
                    return (
                      <td
                        key={entries[index].record.id}
                        className={index === best ? "is-best" : undefined}
                      >
                        <span className="compare-value">
                          {text !== undefined
                            ? (text ?? "—")
                            : fmt(value, digits)}
                          {text === undefined && value !== null && row.unit && (
                            <span className="compare-unit"> {row.unit}</span>
                          )}
                        </span>
                        {delta !== null && (
                          <span className="compare-delta">
                            {signed(delta, digits)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(note || multi) && (
        <p className="chart-mode-note compare-table-note">
          {note ? `${note} ` : ""}
          {multi
            ? "Highlighted: best value in each row. Small numbers show the difference from the reference."
            : ""}
        </p>
      )}
    </div>
  );
}

/** Average delay bars with a ±1 std dev spread, above the full table. */
export function CompareLatency({ entries, referenceIndex }: ViewProps) {
  const stats = entries.map(({ record }) => latencyStats(record.payload));
  const scale = Math.max(1, ...stats.map((s) => (s.avg ?? 0) + (s.std ?? 0)));
  const pct = (value: number) =>
    `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;

  return (
    <div>
      <div
        className="compare-bars"
        role="img"
        aria-label="Average latency per measurement, with one standard deviation spread"
      >
        {entries.map(({ record, deviceName, color }, index) => {
          const { avg, std } = stats[index];
          return (
            <div className="compare-bar-row" key={record.id}>
              <span className="compare-bar-name" title={deviceName}>
                {deviceName}
              </span>
              <span className="compare-bar-track">
                {avg !== null && (
                  <span
                    className="compare-bar-fill"
                    style={{ width: pct(avg), background: color }}
                  />
                )}
                {avg !== null && std !== null && std > 0 && (
                  <span
                    className="compare-bar-spread"
                    style={{ left: pct(avg - std), width: pct(2 * std) }}
                  />
                )}
              </span>
              <span className="compare-bar-value">
                {fmt(avg)}
                <span className="compare-unit"> ms</span>
              </span>
            </div>
          );
        })}
      </div>
      <CompareTable
        entries={entries}
        referenceIndex={referenceIndex}
        rows={[
          {
            key: "avg",
            label: "Average delay",
            unit: "ms",
            values: stats.map((s) => s.avg),
            better: "lower",
          },
          {
            key: "std",
            label: "Std deviation",
            unit: "ms",
            values: stats.map((s) => s.std),
            better: "lower",
          },
          {
            key: "min",
            label: "Fastest run",
            unit: "ms",
            values: stats.map((s) => s.min),
          },
          {
            key: "max",
            label: "Slowest run",
            unit: "ms",
            values: stats.map((s) => s.max),
          },
          {
            key: "n",
            label: "Runs",
            values: stats.map((s) => s.n),
            digits: 0,
          },
        ]}
      />
    </div>
  );
}

export function CompareThd({ entries, referenceIndex }: ViewProps) {
  const points = entries.map(({ record }) => thdPoints(record.payload));
  const tones = Array.from(
    new Set(points.flatMap((list) => list.map((p) => p.freq))),
  ).sort((a, b) => a - b);
  const rows: MetricRow[] = tones.map((tone) => ({
    key: `thd-${tone}`,
    label: `THD at ${fmtHz(tone)} Hz`,
    unit: "%",
    digits: 3,
    better: "lower",
    values: points.map(
      (list) => list.find((p) => p.freq === tone)?.thdPercent ?? null,
    ),
  }));
  if (tones.length > 1) {
    rows.push({
      key: "thd-mean",
      label: "Mean THD",
      unit: "%",
      digits: 3,
      better: "lower",
      values: points.map((list) =>
        list.length
          ? list.reduce((sum, p) => sum + p.thdPercent, 0) / list.length
          : null,
      ),
    });
  }
  return (
    <CompareTable
      entries={entries}
      referenceIndex={referenceIndex}
      rows={rows}
    />
  );
}

export function CompareBalance({ entries, referenceIndex }: ViewProps) {
  const stats = entries.map(({ record }) => balanceStats(record.payload));
  return (
    <CompareTable
      entries={entries}
      referenceIndex={referenceIndex}
      note={toneMismatch(stats.map((s) => s.freq))}
      rows={[
        {
          key: "diff",
          label: "Left minus right",
          unit: "dB",
          values: stats.map((s) => s.diff),
          better: "zero",
        },
        {
          key: "left",
          label: "Left level",
          unit: "dBFS",
          digits: 1,
          values: stats.map((s) => s.left),
        },
        {
          key: "right",
          label: "Right level",
          unit: "dBFS",
          digits: 1,
          values: stats.map((s) => s.right),
        },
        {
          key: "freq",
          label: "Test tone",
          unit: "Hz",
          digits: 0,
          values: stats.map((s) => s.freq),
        },
      ]}
    />
  );
}

export function CompareCrosstalk({ entries, referenceIndex }: ViewProps) {
  const stats = entries.map(({ record }) => crosstalkStats(record.payload));
  return (
    <CompareTable
      entries={entries}
      referenceIndex={referenceIndex}
      note={toneMismatch(stats.map((s) => s.freq))}
      rows={[
        {
          key: "db",
          label: "Crosstalk",
          unit: "dB",
          digits: 1,
          values: stats.map((s) => s.db),
          better: "lower",
        },
        {
          key: "direction",
          label: "Direction",
          values: stats.map(() => null),
          texts: stats.map((s) =>
            s.direction === "RtoL"
              ? "Right to left"
              : s.direction === "LtoR"
                ? "Left to right"
                : null,
          ),
        },
        {
          key: "freq",
          label: "Test tone",
          unit: "Hz",
          digits: 0,
          values: stats.map((s) => s.freq),
        },
      ]}
    />
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCurvePath,
  fmtHz,
  fromX,
  nearestFreqIndex,
  toX,
} from "../lib/chart-scale";

/**
 * One drawable curve. Each series carries its OWN `freqs`, so curves measured
 * on different frequency grids (e.g. two devices) overlay correctly on the
 * shared log X axis.
 */
export type OverlaySeries = {
  id: string;
  label: string;
  color: string;
  /** Optional SVG `stroke-dasharray`, e.g. "2.5 2" for a dashed (R) channel. */
  dash?: string;
  freqs: number[];
  values: number[];
};

export type OverlayHoverItem = {
  id: string;
  label: string;
  color: string;
  value: number;
};

export type OverlayHoverInfo = {
  hz: number;
  items: OverlayHoverItem[];
};

type Props = {
  series: OverlaySeries[];
  yMin: number;
  yMax: number;
  /** Override the auto-computed Y gridline values. */
  yTicks?: number[];
  /** Draw the dashed 0 reference line (default true when 0 is in range). */
  zeroLine?: boolean;
  ariaLabel?: string;
  /** Centered text shown when there are no series to draw. */
  emptyMessage?: string;
  /** Fired on mouse move (nearest point per series) and null on leave. */
  onHover?: (info: OverlayHoverInfo | null) => void;
  /** Built-in cursor-following tooltip (default true). */
  tooltip?: boolean;
  /** Y axis unit label drawn in the top-left corner (default "dB"). */
  yAxisLabel?: string;
  /** X axis unit label drawn in the bottom-right corner (default "Hz"). */
  xAxisLabel?: string;
};

const X_GUIDES_MAJOR = [100, 500, 1000, 5000, 10000];
const X_GUIDES_MINOR = [30, 50, 200, 300, 700, 2000, 3000, 7000, 15000];

/**
 * Reusable multi-curve frequency-response chart. Lifted from the ANC page so
 * the ANC view and the device-comparison view share one renderer. Colors come
 * from the caller (CSS-variable strings), so it inherits theme + accent.
 */
export function OverlayChart({
  series,
  yMin,
  yMax,
  yTicks,
  zeroLine,
  ariaLabel,
  emptyMessage,
  onHover,
  tooltip = true,
  yAxisLabel = "dB",
  xAxisLabel = "Hz",
}: Props) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Cursor position in wrapper pixels, for placing the HTML tooltip.
  const [hoverPx, setHoverPx] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ySpan = yMax - yMin || 1;

  function toY(value: number): number {
    const clamped = Math.max(yMin, Math.min(yMax, value));
    return 10 + ((yMax - clamped) / ySpan) * 80;
  }

  const ticks = useMemo<number[]>(() => {
    if (yTicks) return yTicks;
    const out: number[] = [yMax];
    const step = ySpan >= 40 ? 10 : 5;
    for (let v = Math.floor(yMax / step) * step; v > yMin; v -= step) {
      if (v < yMax && v > yMin && !out.includes(v)) out.push(v);
    }
    if (!out.includes(0) && yMin <= 0 && yMax >= 0) out.push(0);
    out.push(yMin);
    return Array.from(new Set(out)).sort((a, b) => b - a);
  }, [yMin, yMax, ySpan, yTicks]);

  const hoverInfo = useMemo<OverlayHoverInfo | null>(() => {
    if (hoverX === null || series.length === 0) return null;
    const hz = fromX(hoverX);
    const items: OverlayHoverItem[] = [];
    let labelHz = hz;
    let labelHzSet = false;
    for (const s of series) {
      const idx = nearestFreqIndex(s.freqs, hz);
      if (idx < 0) continue;
      if (!labelHzSet) {
        labelHz = s.freqs[idx];
        labelHzSet = true;
      }
      const value = s.values[idx];
      if (value === undefined || !Number.isFinite(value)) continue;
      items.push({ id: s.id, label: s.label, color: s.color, value });
    }
    return { hz: labelHz, items };
  }, [hoverX, series]);

  // Report hover changes without making `onHover` identity a render dependency.
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  useEffect(() => {
    onHoverRef.current?.(hoverInfo);
  }, [hoverInfo]);

  const showZero = (zeroLine ?? true) && yMin <= 0 && yMax >= 0 ? toY(0) : null;

  const chartLabel =
    ariaLabel ??
    `Frequency response graph${series.length > 0 ? ` with ${series.length} curve${series.length === 1 ? "" : "s"}` : ""}`;

  const showTooltip =
    tooltip &&
    hoverPx !== null &&
    hoverInfo !== null &&
    hoverInfo.items.length > 0;
  const tooltipOnLeft =
    hoverPx !== null &&
    wrapRef.current !== null &&
    hoverPx.x > wrapRef.current.clientWidth / 2;

  return (
    <div className="overlay-chart-wrap" ref={wrapRef}>
      <svg
        viewBox="0 0 220 110"
        style={{ width: "100%", display: "block" }}
        role="img"
        aria-label={chartLabel}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * 220 - 20;
          if (px < 0 || px > 200) {
            setHoverX(null);
            setHoverPx(null);
            return;
          }
          setHoverX(px);
          const wrapRect = wrapRef.current?.getBoundingClientRect();
          if (wrapRect) {
            setHoverPx({
              x: e.clientX - wrapRect.left,
              y: e.clientY - wrapRect.top,
            });
          }
        }}
        onMouseLeave={() => {
          setHoverX(null);
          setHoverPx(null);
        }}
      >
        <title>{chartLabel}</title>

        {/* Axis unit labels */}
        <text
          x="16"
          y="6"
          textAnchor="end"
          fontSize="5"
          fill="var(--text-muted)"
        >
          {yAxisLabel}
        </text>
        <text
          x="219"
          y="100"
          textAnchor="end"
          fontSize="5"
          fill="var(--text-muted)"
        >
          {xAxisLabel}
        </text>

        {/* Y-axis labels */}
        {ticks.map((db) => (
          <text
            key={`ylabel-${db}`}
            x="16"
            y={toY(db) + 3}
            textAnchor="end"
            fontSize="6"
            fill="var(--text-muted)"
          >
            {db > 0 ? `+${db}` : db}
          </text>
        ))}

        {/* Graph area offset by 20px for Y labels */}
        <g transform="translate(20, 0)">
          <line
            x1="0"
            y1="10"
            x2="200"
            y2="10"
            stroke="var(--level-grid)"
            strokeWidth="0.4"
          />
          <line
            x1="0"
            y1="90"
            x2="200"
            y2="90"
            stroke="var(--level-grid)"
            strokeWidth="0.4"
          />

          {/* Minor x-grid */}
          {X_GUIDES_MINOR.map((hz) => {
            const x = toX(hz);
            return (
              <line
                key={`xminor-${hz}`}
                x1={x}
                y1="10"
                x2={x}
                y2="90"
                stroke="var(--level-grid)"
                strokeWidth="0.2"
                opacity="0.45"
              />
            );
          })}

          {/* Major x-grid + labels */}
          {X_GUIDES_MAJOR.map((hz) => {
            const x = toX(hz);
            const label = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
            return (
              <g key={`xguide-${hz}`}>
                <line
                  x1={x}
                  y1="8"
                  x2={x}
                  y2="92"
                  stroke="var(--level-grid)"
                  strokeWidth="0.4"
                />
                <text
                  x={x}
                  y="100"
                  textAnchor="middle"
                  fontSize="6"
                  fill="var(--text-muted)"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* 0 reference line */}
          {showZero !== null && (
            <>
              <line
                x1="0"
                y1={showZero}
                x2="200"
                y2={showZero}
                stroke="var(--stroke)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x="202"
                y={showZero + 3}
                fontSize="6"
                fill="var(--text-muted)"
              >
                0
              </text>
            </>
          )}

          {/* Curves */}
          {series.map((s) => {
            const path = buildCurvePath(s.freqs, s.values, toY);
            if (!path) return null;
            return (
              <path
                key={s.id}
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth="1"
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {/* Hover crosshair */}
          {hoverX !== null && hoverInfo && hoverInfo.items.length > 0 && (
            <g pointerEvents="none">
              <line
                x1={hoverX}
                y1="10"
                x2={hoverX}
                y2="90"
                stroke="var(--accent-9)"
                strokeWidth="0.5"
                opacity="0.7"
              />
              {hoverInfo.items.map((item) => (
                <circle
                  key={item.id}
                  cx={hoverX}
                  cy={toY(item.value)}
                  r="1.5"
                  fill={item.color}
                  stroke="var(--text-strong)"
                  strokeWidth="0.4"
                />
              ))}
            </g>
          )}

          {/* Empty state */}
          {series.length === 0 && emptyMessage && (
            <text
              x="100"
              y="54"
              textAnchor="middle"
              fontSize="8"
              fill="var(--text-muted)"
            >
              {emptyMessage}
            </text>
          )}
        </g>
      </svg>

      {showTooltip && hoverPx && hoverInfo && (
        <div
          className="chart-tooltip"
          style={{
            left: tooltipOnLeft ? hoverPx.x - 12 : hoverPx.x + 12,
            top: hoverPx.y + 8,
            transform: tooltipOnLeft ? "translateX(-100%)" : undefined,
          }}
        >
          <div className="chart-tooltip-hz">{fmtHz(hoverInfo.hz)} Hz</div>
          {hoverInfo.items.map((item) => (
            <div key={item.id} className="chart-tooltip-row">
              <span
                className="chart-swatch"
                aria-hidden="true"
                style={{ background: item.color }}
              />
              <span className="chart-tooltip-label">{item.label}</span>
              <strong>
                {item.value.toFixed(1)} {yAxisLabel}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

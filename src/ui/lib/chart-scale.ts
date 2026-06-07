/**
 * Log-frequency chart scaling shared by the ANC page and the device-comparison
 * overlay chart. Extracted from anc-page.tsx so both render curves on an
 * identical 20 Hz–20 kHz log X axis. Pure functions — safe to unit test.
 *
 * The plot area is 200 SVG units wide (`toX` maps Hz → 0..200).
 */

export const MIN_LOG = Math.log10(20);
export const MAX_LOG = Math.log10(20000);
export const SPAN_LOG = MAX_LOG - MIN_LOG;

/** Map a frequency (Hz, clamped to 20..20000) to an X position in 0..200. */
export function toX(hz: number): number {
  return (
    ((Math.log10(Math.max(20, Math.min(20000, hz))) - MIN_LOG) / SPAN_LOG) * 200
  );
}

/** Inverse of `toX`: an X position in 0..200 back to a frequency in Hz. */
export function fromX(x: number): number {
  const logHz = MIN_LOG + (x / 200) * SPAN_LOG;
  return Math.pow(10, logHz);
}

/**
 * Build a smooth (quadratic-bezier) SVG path for one curve. `toY` maps a value
 * to the vertical axis (kept as a parameter so callers own the dB/range scale).
 * Non-finite points are dropped; returns "" if fewer than 2 drawable points.
 */
export function buildCurvePath(
  freqs: number[],
  values: number[],
  toY: (value: number) => number,
): string {
  if (freqs.length < 2 || values.length < 2) return "";
  const points = freqs
    .map((hz, i) => ({ x: toX(hz), y: toY(values[i]) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 2) return "";
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  path += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return path;
}

/** Index of the frequency nearest `hz` (log distance). -1 for empty input. */
export function nearestFreqIndex(freqs: number[], hz: number): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  const target = Math.log10(hz);
  for (let i = 0; i < freqs.length; i += 1) {
    const dist = Math.abs(Math.log10(freqs[i]) - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Compact Hz label, e.g. 1000 → "1k", 12000 → "12k", 440 → "440". */
export function fmtHz(hz: number): string {
  return hz >= 1000
    ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k`
    : `${Math.round(hz)}`;
}

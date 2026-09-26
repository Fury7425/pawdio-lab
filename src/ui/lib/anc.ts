import type { AncSnapshot } from "../model";

/**
 * Per-frequency attenuation of `snapshot` against `baseline` for one side:
 * `snapshot − baseline` in dB, negative where the mode is quieter.
 *
 * Only the frequencies both captures cover are returned. A side that was never
 * captured (a guided mono run cancelled half way) gives an empty curve rather
 * than a run of NaN, which would render as gaps and cannot be sent to the
 * backend for export.
 */
export function ancAttenuation(
  snapshot: AncSnapshot,
  baseline: AncSnapshot,
  side: "L" | "R",
): number[] {
  const after = side === "L" ? snapshot.magDbLeft : snapshot.magDbRight;
  const before = side === "L" ? baseline.magDbLeft : baseline.magDbRight;
  const length = Math.min(after.length, before.length);
  return Array.from({ length }, (_, index) => after[index] - before[index]);
}

/** Mean of two per-side curves, falling back to whichever side has data. */
export function averageSides(left: number[], right: number[]): number[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const length = Math.min(left.length, right.length);
  return Array.from({ length }, (_, index) => (left[index] + right[index]) / 2);
}

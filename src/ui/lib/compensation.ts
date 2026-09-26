/**
 * Compensation and bounds curves loaded from plain-text frequency files.
 *
 * Two shapes are supported, both whitespace- or comma-delimited with `*`, `#`
 * and `//` comment lines:
 *
 *   `freq  value`                            -> a single compensation curve
 *   `freq  p10  p25  median  p75  p90`       -> a population curve whose median
 *                                               compensates and whose spread is
 *                                               drawn as a variation band
 *
 * The six-column form is the layout used by population HRTF exports, so files
 * produced for other measurement tools load without conversion. Nothing here
 * touches the audio engine: compensation is display-side arithmetic applied to
 * a measured curve that is already in dB.
 */
import {
  interpolateLog,
  type FrequencyCurve,
  type VariationBand,
} from "./curve-processing";

export type CompensationKind = "curve" | "population";

export type CompensationCurve = {
  /** Stable id used for persistence and select controls. */
  id: string;
  /** Display name, defaulting to the file stem. */
  name: string;
  kind: CompensationKind;
  freqs: number[];
  /** The compensating line; the median column for a population file. */
  values: number[];
  /** Percentile columns, present only for a population file. */
  percentiles?: {
    p10: number[];
    p25: number[];
    p75: number[];
    p90: number[];
  };
};

export type BoundsPair = {
  upper: FrequencyCurve;
  lower: FrequencyCurve;
};

export class CompensationParseError extends Error {}

const COMMENT_PREFIXES = ["*", "#", "//", ";"];

function isCommentLine(line: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/** Split on commas, tabs, semicolons or runs of spaces. */
function splitColumns(line: string): string[] {
  return line
    .split(/[\s,;]+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

export function curveIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "compensation";
}

/** Strip a directory path and a trailing extension from a file name. */
export function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Parse a compensation or bounds text file. Rows are sorted by frequency and
 * non-finite or non-positive frequencies are dropped, so a file with a stray
 * `0.000000` first row still loads.
 */
export function parseCompensationText(
  text: string,
  name: string,
): CompensationCurve {
  const rows: number[][] = [];
  // Narrowest row: a file only counts as a six-column population export when
  // every row has all six columns. Mixing widths used to read missing
  // percentiles as 0 dB.
  let width = Number.POSITIVE_INFINITY;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || isCommentLine(line)) continue;
    const cells = splitColumns(line);
    if (cells.length < 2) continue;
    const numbers = cells.map((cell) => Number(cell));
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    if (!(numbers[0] > 0)) continue;
    rows.push(numbers);
    width = Math.min(width, numbers.length);
  }

  if (rows.length < 2) {
    throw new CompensationParseError(
      `${name}: expected at least two "frequency value" rows.`,
    );
  }

  rows.sort((left, right) => left[0] - right[0]);
  const freqs = rows.map((row) => row[0]);
  const column = (index: number) => rows.map((row) => row[index] ?? 0);

  if (width >= 6) {
    return {
      id: curveIdFromName(name),
      name,
      kind: "population",
      freqs,
      values: column(3),
      percentiles: {
        p10: column(1),
        p25: column(2),
        p75: column(4),
        p90: column(5),
      },
    };
  }

  return {
    id: curveIdFromName(name),
    name,
    kind: "curve",
    freqs,
    values: column(1),
  };
}

/** The compensating line as a plain curve. */
export function compensationCurve(
  compensation: CompensationCurve,
): FrequencyCurve {
  return { freqs: compensation.freqs, values: compensation.values };
}

/**
 * Subtract a compensation curve from a measurement, keeping the measurement's
 * own frequency grid. Points outside the compensation range are dropped rather
 * than extrapolated, which is what makes a 20 Hz-20 kHz target safe to apply to
 * a sweep that starts lower.
 */
export function applyCompensation(
  curve: FrequencyCurve,
  compensation: CompensationCurve | null,
): FrequencyCurve {
  if (!compensation) return curve;
  const reference = compensationCurve(compensation);
  const freqs: number[] = [];
  const values: number[] = [];
  curve.freqs.forEach((frequency, index) => {
    const value = curve.values[index];
    const target = interpolateLog(reference, frequency);
    if (target === null || !Number.isFinite(value)) return;
    freqs.push(frequency);
    values.push(value - target);
  });
  return { freqs, values };
}

/**
 * Build a variation band from a population file, expressed relative to its own
 * median. Applied on top of a compensated measurement it shows how much of the
 * curve's shape is inside the population spread.
 */
export function populationBand(
  compensation: CompensationCurve | null,
): VariationBand | null {
  if (!compensation?.percentiles) return null;
  const { p10, p25, p75, p90 } = compensation.percentiles;
  const median = compensation.values;
  return {
    freqs: compensation.freqs,
    p10: p10.map((value, index) => value - median[index]),
    p25: p25.map((value, index) => value - median[index]),
    median: median.map(() => 0),
    p75: p75.map((value, index) => value - median[index]),
    p90: p90.map((value, index) => value - median[index]),
  };
}

/**
 * Resample a band onto a target frequency grid so it can be drawn behind a
 * measured curve that uses a different grid. Frequencies outside the band are
 * dropped.
 */
export function resampleBand(
  band: VariationBand,
  freqs: number[],
): VariationBand | null {
  const columns: (keyof Omit<VariationBand, "freqs">)[] = [
    "p10",
    "p25",
    "median",
    "p75",
    "p90",
  ];
  const out: VariationBand = {
    freqs: [],
    p10: [],
    p25: [],
    median: [],
    p75: [],
    p90: [],
  };
  for (const frequency of freqs) {
    const sampled = columns.map((column) =>
      interpolateLog({ freqs: band.freqs, values: band[column] }, frequency),
    );
    if (sampled.some((value) => value === null)) continue;
    out.freqs.push(frequency);
    columns.forEach((column, index) => {
      out[column].push(sampled[index] as number);
    });
  }
  return out.freqs.length > 1 ? out : null;
}

/**
 * Pair two loaded curves into preference bounds. The caller picks which file is
 * which; this only normalises them into plain curves.
 */
export function boundsFromCurves(
  upper: CompensationCurve,
  lower: CompensationCurve,
): BoundsPair {
  return {
    upper: compensationCurve(upper),
    lower: compensationCurve(lower),
  };
}

/**
 * Shift a bounds pair so its own midpoint sits at 0 dB at the reference
 * frequency, matching a measurement that has been normalised the same way.
 */
export function normalizeBoundsAt(
  bounds: BoundsPair,
  frequencyHz = 1000,
): BoundsPair {
  const upperAt = interpolateLog(bounds.upper, frequencyHz);
  const lowerAt = interpolateLog(bounds.lower, frequencyHz);
  if (upperAt === null || lowerAt === null) return bounds;
  const offset = (upperAt + lowerAt) / 2;
  return {
    upper: {
      freqs: bounds.upper.freqs,
      values: bounds.upper.values.map((value) => value - offset),
    },
    lower: {
      freqs: bounds.lower.freqs,
      values: bounds.lower.values.map((value) => value - offset),
    },
  };
}

/**
 * Fraction of a curve's points that fall inside the bounds, plus the count of
 * points that were comparable at all. Returns null when nothing overlaps.
 */
export function boundsCoverage(
  curve: FrequencyCurve,
  bounds: BoundsPair,
): { inside: number; total: number } | null {
  let inside = 0;
  let total = 0;
  curve.freqs.forEach((frequency, index) => {
    const value = curve.values[index];
    const high = interpolateLog(bounds.upper, frequency);
    const low = interpolateLog(bounds.lower, frequency);
    if (high === null || low === null || !Number.isFinite(value)) return;
    total += 1;
    if (value <= high && value >= low) inside += 1;
  });
  return total > 0 ? { inside, total } : null;
}

/**
 * Turn a measured curve into the curve that gets drawn.
 *
 * The order is deliberate. Compensation is applied to the raw measurement,
 * because the target curve describes the rig and not the smoothed picture of
 * it. Smoothing comes next, so the compensated shape is what gets averaged.
 * Normalisation is last, so whatever the eye is asked to compare is anchored at
 * the reference frequency after every other step has moved it.
 */
import {
  applyCompensation,
  populationBand,
  resampleBand,
  type BoundsPair,
  type CompensationCurve,
} from "./compensation";
import {
  normalizeCurveAt,
  smoothFractionalOctave,
  type FrequencyCurve,
  type VariationBand,
} from "./curve-processing";

export type CurveViewOptions = {
  /** Octave denominator, or null for no smoothing. */
  smoothing: number | null;
  normalize: boolean;
  normalizeHz: number;
  compensation: CompensationCurve | null;
  /** Draw the population spread behind the curve when the file carries one. */
  showPopulationBand: boolean;
};

export type ProcessedCurve = FrequencyCurve & {
  /** Percentile envelope in the chart's own shape, when there is one. */
  band?: {
    outerLow: number[];
    outerHigh: number[];
    innerLow: number[];
    innerHigh: number[];
  };
};

export function processCurve(
  curve: FrequencyCurve,
  options: CurveViewOptions,
): ProcessedCurve {
  let working: FrequencyCurve = curve;
  if (options.compensation) {
    working = applyCompensation(working, options.compensation);
  }
  if (options.smoothing) {
    working = smoothFractionalOctave(working, options.smoothing);
  }
  if (options.normalize) {
    working = normalizeCurveAt(working, options.normalizeHz);
  }

  const processed: ProcessedCurve = {
    freqs: working.freqs,
    values: working.values,
  };

  if (options.showPopulationBand && options.compensation?.percentiles) {
    const band = populationBand(options.compensation);
    const resampled = band ? resampleBand(band, working.freqs) : null;
    if (resampled) {
      processed.band = bandToEnvelope(resampled, working);
    }
  }
  return processed;
}

/**
 * Place a percentile band around the curve it belongs to.
 *
 * The band arrives as a spread around zero, so it is added back onto the
 * curve's own values at each frequency. Frequencies the band does not cover
 * collapse onto the curve, which draws as no band rather than a gap.
 */
function bandToEnvelope(
  band: VariationBand,
  curve: FrequencyCurve,
): NonNullable<ProcessedCurve["band"]> {
  const lookup = new Map<number, number>();
  band.freqs.forEach((frequency, index) => lookup.set(frequency, index));

  const outerLow: number[] = [];
  const outerHigh: number[] = [];
  const innerLow: number[] = [];
  const innerHigh: number[] = [];

  curve.freqs.forEach((frequency, index) => {
    const value = curve.values[index];
    const bandIndex = lookup.get(frequency);
    if (bandIndex === undefined) {
      outerLow.push(value);
      outerHigh.push(value);
      innerLow.push(value);
      innerHigh.push(value);
      return;
    }
    outerLow.push(value + band.p10[bandIndex]);
    outerHigh.push(value + band.p90[bandIndex]);
    innerLow.push(value + band.p25[bandIndex]);
    innerHigh.push(value + band.p75[bandIndex]);
  });

  return { outerLow, outerHigh, innerLow, innerHigh };
}

/**
 * Prepare preference bounds for drawing alongside a processed curve. The bounds
 * get the same smoothing and normalisation so the comparison is like for like.
 */
export function processBounds(
  bounds: BoundsPair,
  options: CurveViewOptions,
): BoundsPair {
  const shape = (curve: FrequencyCurve): FrequencyCurve => {
    let working = curve;
    if (options.smoothing) {
      working = smoothFractionalOctave(working, options.smoothing);
    }
    return working;
  };

  const upper = shape(bounds.upper);
  const lower = shape(bounds.lower);
  if (!options.normalize) return { upper, lower };

  // Both bounds shift by the same amount, so the band keeps its width.
  const midpoint: FrequencyCurve = {
    freqs: upper.freqs,
    values: upper.values.map(
      (value, index) => (value + (lower.values[index] ?? value)) / 2,
    ),
  };
  const anchored = normalizeCurveAt(midpoint, options.normalizeHz);
  const offset = midpoint.values[0] - anchored.values[0];
  return {
    upper: {
      freqs: upper.freqs,
      values: upper.values.map((value) => value - offset),
    },
    lower: {
      freqs: lower.freqs,
      values: lower.values.map((value) => value - offset),
    },
  };
}

/** A short caption naming everything currently applied to the drawn curve. */
export function viewSummary(options: CurveViewOptions): string {
  const parts: string[] = [];
  parts.push(options.smoothing ? `1/${options.smoothing} oct` : "raw");
  if (options.normalize) {
    const hz =
      options.normalizeHz >= 1000
        ? `${options.normalizeHz / 1000} kHz`
        : `${options.normalizeHz} Hz`;
    parts.push(`0 dB at ${hz}`);
  }
  parts.push(
    options.compensation
      ? `compensated to ${options.compensation.name}`
      : "uncompensated",
  );
  return parts.join(" · ");
}

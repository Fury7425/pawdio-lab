export type FrequencyCurve = {
  freqs: number[];
  values: number[];
};

export type VariationBand = {
  freqs: number[];
  p10: number[];
  p25: number[];
  median: number[];
  p75: number[];
  p90: number[];
};

function finiteCurve(curve: FrequencyCurve): FrequencyCurve {
  const points = curve.freqs
    .map((frequency, index) => ({
      frequency,
      value: curve.values[index],
    }))
    .filter(
      (point) =>
        Number.isFinite(point.frequency) &&
        point.frequency > 0 &&
        Number.isFinite(point.value),
    )
    .sort((left, right) => left.frequency - right.frequency);
  return {
    freqs: points.map((point) => point.frequency),
    values: points.map((point) => point.value),
  };
}

/** Interpolate a curve linearly on a log-frequency axis. */
export function interpolateLog(
  curve: FrequencyCurve,
  frequencyHz: number,
): number | null {
  const { freqs, values } = curve;
  if (
    freqs.length === 0 ||
    values.length === 0 ||
    !Number.isFinite(frequencyHz) ||
    frequencyHz < freqs[0] ||
    frequencyHz > freqs[freqs.length - 1]
  ) {
    return null;
  }

  let low = 0;
  let high = freqs.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (freqs[middle] === frequencyHz) return values[middle] ?? null;
    if (freqs[middle] < frequencyHz) low = middle + 1;
    else high = middle - 1;
  }

  const right = Math.min(low, freqs.length - 1);
  const left = Math.max(0, right - 1);
  const leftHz = freqs[left];
  const rightHz = freqs[right];
  const span = Math.log2(rightHz) - Math.log2(leftHz);
  if (span <= 0) return values[left] ?? null;
  const amount = (Math.log2(frequencyHz) - Math.log2(leftHz)) / span;
  return values[left] + (values[right] - values[left]) * amount;
}

/** Return a copy offset so the interpolated reference frequency is 0 dB. */
export function normalizeCurveAt(
  curve: FrequencyCurve,
  frequencyHz = 1000,
): FrequencyCurve {
  const reference = interpolateLog(curve, frequencyHz);
  if (reference === null || !Number.isFinite(reference)) return curve;
  return {
    freqs: curve.freqs,
    values: curve.values.map((value) => value - reference),
  };
}

/**
 * Gaussian fractional-octave smoothing. The selected fraction is the
 * full-width at half maximum in octaves; input and output grids are identical.
 */
export function smoothFractionalOctave(
  curve: FrequencyCurve,
  fraction: number | null,
): FrequencyCurve {
  if (!fraction || fraction <= 0 || curve.freqs.length < 3) return curve;

  const sigmaOctaves =
    1 / fraction / (2 * Math.sqrt(2 * Math.log(2)));
  const radiusOctaves = sigmaOctaves * 4;
  const logs = curve.freqs.map((frequency) => Math.log2(frequency));
  const values = logs.map((center, index) => {
    let weighted = 0;
    let totalWeight = 0;
    for (let other = 0; other < logs.length; other += 1) {
      const distance = logs[other] - center;
      if (Math.abs(distance) > radiusOctaves) continue;
      const value = curve.values[other];
      if (!Number.isFinite(value)) continue;
      const weight = Math.exp(
        -0.5 * (distance / sigmaOctaves) * (distance / sigmaOctaves),
      );
      weighted += value * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weighted / totalWeight : curve.values[index];
  });
  return { freqs: curve.freqs, values };
}

/** Subtract a reference curve, preserving only the overlapping frequencies. */
export function subtractReference(
  curve: FrequencyCurve,
  reference: FrequencyCurve,
): FrequencyCurve {
  const freqs: number[] = [];
  const values: number[] = [];
  curve.freqs.forEach((frequency, index) => {
    const referenceValue = interpolateLog(reference, frequency);
    const value = curve.values[index];
    if (referenceValue === null || !Number.isFinite(value)) return;
    freqs.push(frequency);
    values.push(value - referenceValue);
  });
  return { freqs, values };
}

function percentile(sorted: number[], amount: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * amount;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

/**
 * Resample curves to their shared log-frequency range and compute Fastgraph-
 * style p10-p90 and p25-p75 bands with a median center line.
 */
export function computeVariationBand(
  input: FrequencyCurve[],
  pointCount = 600,
): VariationBand | null {
  const curves = input
    .map(finiteCurve)
    .filter((curve) => curve.freqs.length > 1);
  if (curves.length < 2) return null;

  const minimum = Math.max(...curves.map((curve) => curve.freqs[0]));
  const maximum = Math.min(
    ...curves.map((curve) => curve.freqs[curve.freqs.length - 1]),
  );
  if (!(minimum > 0) || maximum <= minimum) return null;

  const count = Math.max(2, Math.round(pointCount));
  const minLog = Math.log10(minimum);
  const maxLog = Math.log10(maximum);
  const freqs = Array.from({ length: count }, (_, index) =>
    Math.pow(10, minLog + (index / (count - 1)) * (maxLog - minLog)),
  );

  const p10: number[] = [];
  const p25: number[] = [];
  const median: number[] = [];
  const p75: number[] = [];
  const p90: number[] = [];
  for (const frequency of freqs) {
    const values = curves
      .map((curve) => interpolateLog(curve, frequency))
      .filter(
        (value): value is number =>
          value !== null && Number.isFinite(value),
      )
      .sort((left, right) => left - right);
    if (values.length < 2) return null;
    p10.push(percentile(values, 0.1));
    p25.push(percentile(values, 0.25));
    median.push(percentile(values, 0.5));
    p75.push(percentile(values, 0.75));
    p90.push(percentile(values, 0.9));
  }
  return { freqs, p10, p25, median, p75, p90 };
}

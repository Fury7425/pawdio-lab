/**
 * Absolute SPL calibration for the capture chain.
 *
 * The measured dB in a sweep is relative: it says how the response is shaped,
 * not how loud it is. Calibration fixes that by measuring one known level. The
 * user puts the microphone in an acoustic calibrator (a 94 dB SPL 1 kHz piston
 * is the usual one), reads the live input level, and the sensitivity that
 * relates full scale to pascals falls out of that single point.
 *
 * Sensitivity is stored per input-device name, so switching interfaces does not
 * silently reuse another microphone's number.
 */

export const SPL_CALIBRATION_KEY = "pawdio-lab-spl-calibration-v1";

/** Reference pressure for dB SPL, 20 micropascal. */
export const REFERENCE_PRESSURE_PA = 20e-6;

/** Level printed on the barrel of the common calibrators. */
export const COMMON_CALIBRATOR_DB_SPL = [94, 114] as const;

export type SplCalibrationStore = {
  /** Device name -> pascals per unit full scale. */
  sensitivityPaPerFs: Record<string, number>;
};

export const EMPTY_SPL_CALIBRATION: SplCalibrationStore = {
  sensitivityPaPerFs: {},
};

/** Convert a dBFS reading to linear full-scale amplitude. */
export function dbfsToLinear(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.pow(10, dbfs / 20);
}

/**
 * Solve for sensitivity from one calibrator reading.
 *
 * `rmsFs` is the observed level as a fraction of full scale and
 * `calibratorDbSpl` is the level the calibrator produces. The result is the
 * pressure in pascals that a full-scale signal corresponds to.
 */
export function sensitivityFromCalibrator(
  rmsFs: number,
  calibratorDbSpl: number,
): number | null {
  if (!Number.isFinite(rmsFs) || rmsFs <= 0) return null;
  if (!Number.isFinite(calibratorDbSpl)) return null;
  const pascals = REFERENCE_PRESSURE_PA * Math.pow(10, calibratorDbSpl / 20);
  const sensitivity = pascals / rmsFs;
  return Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : null;
}

/** Same, starting from a dBFS reading rather than a linear one. */
export function sensitivityFromDbfs(
  dbfs: number,
  calibratorDbSpl: number,
): number | null {
  return sensitivityFromCalibrator(dbfsToLinear(dbfs), calibratorDbSpl);
}

/** Convert a full-scale RMS reading to absolute dB SPL. */
export function rmsToDbSpl(rmsFs: number, sensitivity: number): number | null {
  if (!Number.isFinite(rmsFs) || rmsFs <= 0) return null;
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) return null;
  return 20 * Math.log10((rmsFs * sensitivity) / REFERENCE_PRESSURE_PA);
}

/** Convert a dBFS reading to absolute dB SPL. */
export function dbfsToDbSpl(dbfs: number, sensitivity: number): number | null {
  return rmsToDbSpl(dbfsToLinear(dbfs), sensitivity);
}

/**
 * The constant that turns a relative dB curve into dB SPL.
 *
 * A sweep curve is normalised to some reference point; adding this offset to
 * every point places the curve on the absolute scale, given the level that the
 * reference point was actually captured at.
 */
export function splOffsetDb(
  referenceDbfs: number,
  sensitivity: number,
): number | null {
  return dbfsToDbSpl(referenceDbfs, sensitivity);
}

export function sensitivityFor(
  store: SplCalibrationStore,
  deviceName: string | null | undefined,
): number | null {
  if (!deviceName) return null;
  const value = store.sensitivityPaPerFs[deviceName];
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function withSensitivity(
  store: SplCalibrationStore,
  deviceName: string,
  sensitivity: number,
): SplCalibrationStore {
  return {
    sensitivityPaPerFs: {
      ...store.sensitivityPaPerFs,
      [deviceName]: sensitivity,
    },
  };
}

export function withoutSensitivity(
  store: SplCalibrationStore,
  deviceName: string,
): SplCalibrationStore {
  const next = { ...store.sensitivityPaPerFs };
  delete next[deviceName];
  return { sensitivityPaPerFs: next };
}

/**
 * A sensitivity expressed the way microphone datasheets do, in millivolts per
 * pascal referenced to full scale. Shown next to the raw number because most
 * users recognise this form.
 */
export function sensitivityDbFsPerPa(sensitivity: number): number | null {
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) return null;
  return -20 * Math.log10(sensitivity);
}

export function parseSplCalibration(raw: string | null): SplCalibrationStore {
  if (!raw) return EMPTY_SPL_CALIBRATION;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY_SPL_CALIBRATION;
    const source = (parsed as SplCalibrationStore).sensitivityPaPerFs;
    if (!source || typeof source !== "object") return EMPTY_SPL_CALIBRATION;
    const sensitivityPaPerFs: Record<string, number> = {};
    for (const [device, value] of Object.entries(source)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        sensitivityPaPerFs[device] = value;
      }
    }
    return { sensitivityPaPerFs };
  } catch {
    return EMPTY_SPL_CALIBRATION;
  }
}

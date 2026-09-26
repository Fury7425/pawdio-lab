/**
 * Persisted microphone sensitivity, keyed by input device name.
 *
 * Calibration belongs to the microphone, not the session, so it is stored and
 * looked up by the device that produced it. Switching interfaces therefore
 * reverts to relative dB rather than quietly reusing another mic's number.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePawdioLabContext } from "../pawdio-context";
import {
  EMPTY_SPL_CALIBRATION,
  parseSplCalibration,
  sensitivityFor,
  SPL_CALIBRATION_KEY,
  withSensitivity,
  withoutSensitivity,
  type SplCalibrationStore,
} from "../lib/spl-calibration";

export function useSplCalibration(deviceName: string | null) {
  const [store, setStore] = useState<SplCalibrationStore>(() => {
    try {
      return parseSplCalibration(
        window.localStorage.getItem(SPL_CALIBRATION_KEY),
      );
    } catch {
      return EMPTY_SPL_CALIBRATION;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SPL_CALIBRATION_KEY, JSON.stringify(store));
    } catch {
      // Losing the persisted copy should never interrupt a measurement.
    }
  }, [store]);

  const sensitivity = useMemo(
    () => sensitivityFor(store, deviceName),
    [store, deviceName],
  );

  const save = useCallback(
    (value: number) => {
      if (!deviceName) return;
      setStore((previous) => withSensitivity(previous, deviceName, value));
    },
    [deviceName],
  );

  const clear = useCallback(() => {
    if (!deviceName) return;
    setStore((previous) => withoutSensitivity(previous, deviceName));
  }, [deviceName]);

  return { store, sensitivity, save, clear, calibrated: sensitivity !== null };
}

/**
 * The calibration for whichever input device is currently selected, together
 * with the name it is filed under. Both the settings panel and the live meter
 * read the same value this way.
 */
export function useActiveInputCalibration() {
  const ctx = usePawdioLabContext();
  const deviceName = useMemo(() => {
    // "System Default" resolves to whichever mic the OS currently uses, so file
    // the calibration under that device's own name. A fixed "System Default"
    // key would quietly reuse one mic's sensitivity after the default changed.
    const index =
      ctx.settings.inputDeviceIndex ?? ctx.inventory?.defaultInputIndex ?? null;
    if (index === null) return "System Default Input";
    const device = ctx.inventory?.inputs.find((entry) => entry.index === index);
    return device?.name ?? ctx.settings.inputDeviceName ?? `Input ${index}`;
  }, [
    ctx.settings.inputDeviceIndex,
    ctx.settings.inputDeviceName,
    ctx.inventory,
  ]);

  return { deviceName, ...useSplCalibration(deviceName) };
}

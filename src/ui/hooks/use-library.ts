import { useRef, useState } from "react";
import * as ipc from "../../ipc/commands";
import type {
  DeviceRecord,
  LibraryTestType,
  MeasurementRecord,
  MeasurementSummary,
} from "../model";

type Deps = {
  setError: (message: string) => void;
  /** Optional success feedback (e.g. a toast) after mutations. */
  notify?: (message: string) => void;
};

/**
 * Owns the SQLite-backed measurement library: device records + measurement
 * summaries, plus the mutations that keep them in sync. Full records (with the
 * heavy payload arrays) are fetched lazily via `getMeasurement` and cached so
 * the comparison view doesn't refetch. Follows the `use-devices-controller`
 * pattern — only this hook writes the library state; pages read it.
 *
 * Every mutation refreshes the lists so the UI reflects the DB after the call.
 * A DB error is surfaced via `setError` and never throws, so a library failure
 * can't crash app init.
 */
export function useLibrary({ setError, notify }: Deps) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementSummary[]>([]);
  const recordCache = useRef<Map<number, MeasurementRecord>>(new Map());

  async function loadLibrary() {
    try {
      const [deviceList, measurementList] = await Promise.all([
        ipc.dbListDevices(),
        ipc.dbListMeasurements(),
      ]);
      setDevices(deviceList);
      setMeasurements(measurementList);
    } catch (err) {
      setError(String(err));
    }
  }

  async function createDevice(
    name: string,
    kind?: string,
  ): Promise<DeviceRecord | null> {
    try {
      const device = await ipc.dbCreateDevice(name, kind);
      await loadLibrary();
      return device;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }

  async function renameDevice(id: number, name: string): Promise<void> {
    try {
      await ipc.dbRenameDevice(id, name);
      await loadLibrary();
      notify?.(`Device renamed to "${name}"`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteDevice(id: number): Promise<void> {
    try {
      await ipc.dbDeleteDevice(id);
      // Drop cached records belonging to the (cascade-deleted) device.
      for (const [key, record] of recordCache.current) {
        if (record.deviceId === id) recordCache.current.delete(key);
      }
      await loadLibrary();
      notify?.("Device deleted");
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveMeasurement(args: {
    deviceId: number;
    testType: LibraryTestType;
    label?: string;
    payload: MeasurementRecord["payload"];
  }): Promise<MeasurementRecord | null> {
    try {
      const record = await ipc.dbSaveMeasurement(args);
      recordCache.current.set(record.id, record);
      await loadLibrary();
      notify?.("Measurement saved to library");
      return record;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }

  async function deleteMeasurement(id: number): Promise<void> {
    try {
      await ipc.dbDeleteMeasurement(id);
      recordCache.current.delete(id);
      await loadLibrary();
      notify?.("Measurement deleted");
    } catch (err) {
      setError(String(err));
    }
  }

  /** Cache-through fetch of a full record (payload included). */
  async function getMeasurement(id: number): Promise<MeasurementRecord | null> {
    const cached = recordCache.current.get(id);
    if (cached) return cached;
    try {
      const record = await ipc.dbGetMeasurement(id);
      recordCache.current.set(id, record);
      return record;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }

  return {
    devices,
    measurements,
    loadLibrary,
    createDevice,
    renameDevice,
    deleteDevice,
    saveMeasurement,
    deleteMeasurement,
    getMeasurement,
  };
}

export type Library = ReturnType<typeof useLibrary>;

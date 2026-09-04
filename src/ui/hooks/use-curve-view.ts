/**
 * Display-side processing shared by the curve views.
 *
 * Smoothing, normalisation, compensation and preference bounds all change how a
 * measurement is drawn without changing what was measured. Keeping them in one
 * hook means the sweep page and the comparison view can offer the same controls
 * and stay in step, and it keeps the processing out of the pages themselves.
 *
 * Loaded compensation files live in localStorage so a target survives a
 * restart. They are small text curves, a few hundred rows at most.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  parseCompensationText,
  type CompensationCurve,
} from "../lib/compensation";

export const CURVE_VIEW_KEY = "pawdio-lab-curve-view-v1";
export const COMPENSATION_LIBRARY_KEY = "pawdio-lab-compensation-v1";

/** Fractions offered for smoothing, as the denominator of an octave. */
export const SMOOTHING_FRACTIONS = [48, 24, 12, 6, 3] as const;

export type CurveViewState = {
  /** Octave denominator, or null for no smoothing. */
  smoothing: number | null;
  /** Shift each curve so it reads 0 dB at the reference frequency. */
  normalize: boolean;
  normalizeHz: number;
  /** Id of the active compensation curve, or null for raw. */
  compensationId: string | null;
  /** Ids of the curves used as the upper and lower preference bounds. */
  boundsUpperId: string | null;
  boundsLowerId: string | null;
  showBounds: boolean;
  /** Draw the population spread behind the curve, when the file has one. */
  showPopulationBand: boolean;
};

export const DEFAULT_CURVE_VIEW: CurveViewState = {
  smoothing: 12,
  normalize: true,
  normalizeHz: 1000,
  compensationId: null,
  boundsUpperId: null,
  boundsLowerId: null,
  showBounds: false,
  showPopulationBand: true,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;
    return { ...fallback, ...(parsed as Partial<T>) };
  } catch {
    return fallback;
  }
}

function readLibrary(): CompensationCurve[] {
  try {
    const raw = window.localStorage.getItem(COMPENSATION_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompensationCurve);
  } catch {
    return [];
  }
}

function isCompensationCurve(value: unknown): value is CompensationCurve {
  if (!value || typeof value !== "object") return false;
  const candidate = value as CompensationCurve;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.freqs) &&
    Array.isArray(candidate.values) &&
    candidate.freqs.length > 1 &&
    candidate.freqs.length === candidate.values.length
  );
}

export type CurveViewController = ReturnType<typeof useCurveView>;

export function useCurveView() {
  const [view, setView] = useState<CurveViewState>(() =>
    readJson(CURVE_VIEW_KEY, DEFAULT_CURVE_VIEW),
  );
  const [library, setLibrary] = useState<CompensationCurve[]>(readLibrary);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CURVE_VIEW_KEY, JSON.stringify(view));
    } catch {
      // A full or disabled store is not worth interrupting a measurement for.
    }
  }, [view]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COMPENSATION_LIBRARY_KEY,
        JSON.stringify(library),
      );
    } catch {
      // Same: the curves stay usable for this session either way.
    }
  }, [library]);

  const update = useCallback((patch: Partial<CurveViewState>) => {
    setView((previous) => ({ ...previous, ...patch }));
  }, []);

  /**
   * Add a curve, replacing any earlier one with the same name so re-importing
   * an edited file updates it instead of piling up duplicates.
   */
  const addCurve = useCallback((curve: CompensationCurve) => {
    setLibrary((previous) => [
      ...previous.filter((entry) => entry.id !== curve.id),
      curve,
    ]);
  }, []);

  const removeCurve = useCallback((id: string) => {
    setLibrary((previous) => previous.filter((entry) => entry.id !== id));
    setView((previous) => ({
      ...previous,
      compensationId:
        previous.compensationId === id ? null : previous.compensationId,
      boundsUpperId:
        previous.boundsUpperId === id ? null : previous.boundsUpperId,
      boundsLowerId:
        previous.boundsLowerId === id ? null : previous.boundsLowerId,
    }));
  }, []);

  /** Read one or more picked text files into the library. */
  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const failures: string[] = [];
      for (const file of list) {
        try {
          const text = await file.text();
          addCurve(parseCompensationText(text, stripExtension(file.name)));
        } catch (error) {
          failures.push(
            error instanceof Error ? error.message : `${file.name}: unreadable`,
          );
        }
      }
      setLoadError(failures.length > 0 ? failures.join(" ") : null);
      return failures.length === 0;
    },
    [addCurve],
  );

  const byId = useCallback(
    (id: string | null) =>
      id ? (library.find((entry) => entry.id === id) ?? null) : null,
    [library],
  );

  const compensation = useMemo(
    () => byId(view.compensationId),
    [byId, view.compensationId],
  );
  const boundsUpper = useMemo(
    () => byId(view.boundsUpperId),
    [byId, view.boundsUpperId],
  );
  const boundsLower = useMemo(
    () => byId(view.boundsLowerId),
    [byId, view.boundsLowerId],
  );

  return {
    view,
    update,
    library,
    addCurve,
    removeCurve,
    importFiles,
    loadError,
    clearLoadError: () => setLoadError(null),
    compensation,
    boundsUpper,
    boundsLower,
  };
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

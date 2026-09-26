import { useEffect, useRef } from "react";

/**
 * Debounced persistence helper. Writes `value` to `localStorage[key]` (JSON-serialized)
 * `delayMs` after the last change, coalescing rapid bursts (e.g. slider drag) into a
 * single setItem call.
 *
 * A write still pending when the component unmounts is flushed then, so the latest
 * value is never lost. Flushing only on unmount matters: flushing in the per-change
 * cleanup, as this hook used to, wrote on every keystroke and defeated the debounce.
 */
export function useDebouncedPersist<T>(
  key: string,
  value: T,
  delayMs: number = 250,
): void {
  const valueRef = useRef(value);
  valueRef.current = value;
  const pendingRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (typeof window === "undefined") return;
    pendingRef.current = true;
    const timer = window.setTimeout(() => {
      pendingRef.current = false;
      try {
        window.localStorage.setItem(key, JSON.stringify(valueRef.current));
      } catch {
        // ignore storage errors (quota, private mode, etc.)
      }
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, delayMs]);

  useEffect(
    () => () => {
      if (!pendingRef.current || typeof window === "undefined") return;
      pendingRef.current = false;
      try {
        window.localStorage.setItem(
          keyRef.current,
          JSON.stringify(valueRef.current),
        );
      } catch {
        // ignore
      }
    },
    [],
  );
}

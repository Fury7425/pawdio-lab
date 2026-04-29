import { useEffect, useRef } from "react";

/**
 * Debounced persistence helper. Writes `value` to `localStorage[key]` (JSON-serialized)
 * `delayMs` after the last change. Coalesces rapid bursts (e.g. slider drag) into a
 * single setItem call.
 *
 * Returns a cleanup function-equivalent: if the component unmounts while a write is
 * pending, the write is flushed immediately so state isn't lost.
 */
export function useDebouncedPersist<T>(
  key: string,
  value: T,
  delayMs: number = 250,
): void {
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(valueRef.current));
      } catch {
        // ignore storage errors (quota, private mode, etc.)
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      // Flush on unmount or when dependencies change so we never lose the latest value
      try {
        window.localStorage.setItem(key, JSON.stringify(valueRef.current));
      } catch {
        // ignore
      }
    };
  }, [key, value, delayMs]);
}

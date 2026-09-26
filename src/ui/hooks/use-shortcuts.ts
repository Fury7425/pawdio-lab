/**
 * Rebindable shortcut state plus the one global key listener that fires them.
 *
 * Keeping the listener here means pages do not each register their own, and the
 * bindings the settings screen edits are the same ones the listener reads.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  actionForEvent,
  DEFAULT_SHORTCUT_BINDINGS,
  normalizeBinding,
  parseShortcutBindings,
  SHORTCUTS_KEY,
  type ShortcutAction,
  type ShortcutBindings,
} from "../lib/shortcuts";

// One store for the whole app. The settings screen and the global listener
// used to hold separate copies, so a rebind only took effect after a restart.
let currentBindings: ShortcutBindings | null = null;
const subscribers = new Set<() => void>();

function readBindings(): ShortcutBindings {
  if (currentBindings === null) {
    try {
      currentBindings = parseShortcutBindings(
        window.localStorage.getItem(SHORTCUTS_KEY),
      );
    } catch {
      currentBindings = { ...DEFAULT_SHORTCUT_BINDINGS };
    }
  }
  return currentBindings;
}

function writeBindings(next: ShortcutBindings) {
  currentBindings = next;
  try {
    window.localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(next));
  } catch {
    // The bindings still work for this session.
  }
  subscribers.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function useShortcutBindings() {
  const bindings = useSyncExternalStore(subscribe, readBindings, readBindings);

  const rebind = useCallback((action: ShortcutAction, binding: string) => {
    writeBindings({ ...readBindings(), [action]: normalizeBinding(binding) });
  }, []);

  const resetAll = useCallback(
    () => writeBindings({ ...DEFAULT_SHORTCUT_BINDINGS }),
    [],
  );

  return { bindings, rebind, resetAll };
}

/**
 * Fire `onAction` when a bound chord is pressed. Typing into a field never
 * triggers a shortcut, which is what lets a bare letter be a binding.
 */
export function useShortcutListener(
  bindings: ShortcutBindings,
  onAction: (action: ShortcutAction) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKeydown(event: KeyboardEvent) {
      const action = actionForEvent(event, bindings);
      if (!action) return;
      event.preventDefault();
      onAction(action);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [bindings, onAction, enabled]);
}

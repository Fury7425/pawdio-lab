/**
 * Rebindable shortcut state plus the one global key listener that fires them.
 *
 * Keeping the listener here means pages do not each register their own, and the
 * bindings the settings screen edits are the same ones the listener reads.
 */
import { useCallback, useEffect, useState } from "react";
import {
  actionForEvent,
  DEFAULT_SHORTCUT_BINDINGS,
  normalizeBinding,
  parseShortcutBindings,
  SHORTCUTS_KEY,
  type ShortcutAction,
  type ShortcutBindings,
} from "../lib/shortcuts";

export function useShortcutBindings() {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => {
    try {
      return parseShortcutBindings(window.localStorage.getItem(SHORTCUTS_KEY));
    } catch {
      return DEFAULT_SHORTCUT_BINDINGS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(bindings));
    } catch {
      // The bindings still work for this session.
    }
  }, [bindings]);

  const rebind = useCallback((action: ShortcutAction, binding: string) => {
    setBindings((previous) => ({
      ...previous,
      [action]: normalizeBinding(binding),
    }));
  }, []);

  const resetAll = useCallback(
    () => setBindings({ ...DEFAULT_SHORTCUT_BINDINGS }),
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

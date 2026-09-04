/**
 * Rebindable keyboard shortcuts.
 *
 * Bindings are stored as a canonical string such as `Ctrl+Shift+1` or `Enter`.
 * The same format is produced from a live `KeyboardEvent`, so capturing a new
 * binding is just reading the event and comparing strings.
 */

export const SHORTCUTS_KEY = "pawdio-lab-shortcuts-v1";

export type ShortcutAction =
  | "start_test"
  | "stop_test"
  | "accept_review"
  | "reject_review"
  | "page_latency"
  | "page_sweep_fr"
  | "page_anc"
  | "page_experimental"
  | "page_devices"
  | "page_results"
  | "page_library";

export type ShortcutDefinition = {
  action: ShortcutAction;
  label: string;
  group: "Measurement" | "Navigation";
  defaultBinding: string;
};

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    action: "start_test",
    label: "Start measurement",
    group: "Measurement",
    defaultBinding: "Enter",
  },
  {
    action: "stop_test",
    label: "Stop measurement",
    group: "Measurement",
    defaultBinding: "Escape",
  },
  {
    action: "accept_review",
    label: "Accept sweep",
    group: "Measurement",
    defaultBinding: "K",
  },
  {
    action: "reject_review",
    label: "Discard / redo sweep",
    group: "Measurement",
    defaultBinding: "F",
  },
  {
    action: "page_latency",
    label: "Go to Latency",
    group: "Navigation",
    defaultBinding: "Ctrl+1",
  },
  {
    action: "page_sweep_fr",
    label: "Go to Sweep FR",
    group: "Navigation",
    defaultBinding: "Ctrl+2",
  },
  {
    action: "page_anc",
    label: "Go to ANC",
    group: "Navigation",
    defaultBinding: "Ctrl+3",
  },
  {
    action: "page_experimental",
    label: "Go to Experimental",
    group: "Navigation",
    defaultBinding: "Ctrl+4",
  },
  {
    action: "page_devices",
    label: "Go to Devices",
    group: "Navigation",
    defaultBinding: "Ctrl+5",
  },
  {
    action: "page_results",
    label: "Go to Results",
    group: "Navigation",
    defaultBinding: "Ctrl+6",
  },
  {
    action: "page_library",
    label: "Go to Library",
    group: "Navigation",
    defaultBinding: "Ctrl+7",
  },
];

export type ShortcutBindings = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings =
  SHORTCUT_DEFINITIONS.reduce((accumulator, definition) => {
    accumulator[definition.action] = definition.defaultBinding;
    return accumulator;
  }, {} as ShortcutBindings);

const MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "OS",
  "AltGraph",
  "Dead",
]);

/** Human-readable names for keys whose `event.key` is unhelpfully terse. */
const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Escape",
  Enter: "Enter",
};

function canonicalKey(key: string): string {
  const mapped = KEY_LABELS[key];
  if (mapped) return mapped;
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Canonical binding string for an event, or null when only a modifier is held.
 * Modifier order is fixed so two equal chords always compare equal.
 */
export function bindingFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(canonicalKey(event.key));
  return parts.join("+");
}

/** Normalise a stored or typed binding into the canonical form. */
export function normalizeBinding(binding: string): string {
  const parts = binding
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  const key = canonicalKey(parts[parts.length - 1]);
  const held = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const out: string[] = [];
  if (held.has("ctrl") || held.has("control")) out.push("Ctrl");
  if (held.has("alt")) out.push("Alt");
  if (held.has("shift")) out.push("Shift");
  if (held.has("meta") || held.has("cmd") || held.has("command")) {
    out.push("Meta");
  }
  out.push(key);
  return out.join("+");
}

export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  if (!binding) return false;
  const pressed = bindingFromEvent(event);
  return pressed !== null && pressed === normalizeBinding(binding);
}

/**
 * Find the action bound to an event. Returns null when nothing matches, when
 * the event came from a text field, where a bare `F` must stay a letter, or
 * when the key is already activating the focused control.
 */
export function actionForEvent(
  event: KeyboardEvent,
  bindings: ShortcutBindings,
): ShortcutAction | null {
  if (isTypingTarget(event.target)) return null;
  if (isActivationKeyOnControl(event)) return null;
  const pressed = bindingFromEvent(event);
  if (pressed === null) return null;
  for (const definition of SHORTCUT_DEFINITIONS) {
    const binding = bindings[definition.action];
    if (binding && normalizeBinding(binding) === pressed) {
      return definition.action;
    }
  }
  return null;
}

/** True for inputs, textareas, selects and anything contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const ACTIVATABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);
const ACTIVATABLE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "switch",
]);

/**
 * True when the key pressed already activates the focused control, so the
 * browser will fire a click of its own. Without this, `Enter` on a focused
 * button runs that button *and* the `start_test` shortcut, and `Space` does
 * the same. Letter bindings are unaffected and still work from a button.
 */
export function isActivationKeyOnControl(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
    return false;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (ACTIVATABLE_TAGS.has(target.tagName)) return true;
  const role = target.getAttribute("role");
  return role !== null && ACTIVATABLE_ROLES.has(role);
}

/** Actions currently sharing a binding with another action. */
export function conflictingActions(
  bindings: ShortcutBindings,
): Set<ShortcutAction> {
  const seen = new Map<string, ShortcutAction[]>();
  for (const definition of SHORTCUT_DEFINITIONS) {
    const binding = normalizeBinding(bindings[definition.action] ?? "");
    if (!binding) continue;
    const list = seen.get(binding) ?? [];
    list.push(definition.action);
    seen.set(binding, list);
  }
  const conflicts = new Set<ShortcutAction>();
  for (const list of seen.values()) {
    if (list.length > 1) list.forEach((action) => conflicts.add(action));
  }
  return conflicts;
}

export function parseShortcutBindings(raw: string | null): ShortcutBindings {
  const bindings = { ...DEFAULT_SHORTCUT_BINDINGS };
  if (!raw) return bindings;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return bindings;
    for (const definition of SHORTCUT_DEFINITIONS) {
      const value = (parsed as Record<string, unknown>)[definition.action];
      if (typeof value === "string" && value.trim().length > 0) {
        bindings[definition.action] = normalizeBinding(value);
      }
    }
  } catch {
    return bindings;
  }
  return bindings;
}

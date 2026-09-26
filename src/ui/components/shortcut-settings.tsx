/**
 * Editor for the keyboard shortcuts.
 *
 * Each row captures the next chord pressed while it is armed, which is more
 * reliable than asking someone to type the name of a key combination. Rows that
 * collide with another binding are marked, because a silently shadowed shortcut
 * is worse than an obviously broken one.
 */
import { useState } from "react";
import { Keyboard } from "lucide-react";
import {
  bindingFromEvent,
  conflictingActions,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
  type ShortcutBindings,
} from "../lib/shortcuts";

type Props = {
  bindings: ShortcutBindings;
  onRebind: (action: ShortcutAction, binding: string) => void;
  onReset: () => void;
};

export function ShortcutSettings({ bindings, onRebind, onReset }: Props) {
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const conflicts = conflictingActions(bindings);

  const groups = ["Measurement", "Navigation"] as const;

  return (
    <section className="page-section">
      <h3 className="section-subheading">
        <Keyboard size={15} /> Keyboard Shortcuts
      </h3>
      <p className="muted mb-12">
        Click a shortcut, then press the keys you want. Shortcuts do not fire
        while you are typing in a field.
      </p>

      {groups.map((group) => (
        <div key={group} className="shortcut-table mt-10">
          <h4 className="field-label">{group}</h4>
          {SHORTCUT_DEFINITIONS.filter(
            (definition) => definition.group === group,
          ).map((definition) => {
            const isCapturing = capturing === definition.action;
            const conflicting = conflicts.has(definition.action);
            return (
              <div
                key={definition.action}
                className={`shortcut-row${conflicting ? " is-conflicting" : ""}`}
              >
                <span className="field-label">{definition.label}</span>
                <button
                  type="button"
                  className={`skin-btn secondary shortcut-key${
                    isCapturing ? " is-on" : ""
                  }`}
                  aria-label={`Change shortcut for ${definition.label}`}
                  onClick={() =>
                    setCapturing(isCapturing ? null : definition.action)
                  }
                  onKeyDown={(event) => {
                    if (!isCapturing) return;
                    event.preventDefault();
                    // Keep the chord away from the global listener, or
                    // capturing an already-bound key would also fire it.
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setCapturing(null);
                      return;
                    }
                    const binding = bindingFromEvent(event.nativeEvent);
                    if (!binding) return;
                    onRebind(definition.action, binding);
                    setCapturing(null);
                  }}
                >
                  {isCapturing ? "Press keys…" : bindings[definition.action]}
                </button>
              </div>
            );
          })}
        </div>
      ))}

      {conflicts.size > 0 && (
        <p className="field-error mt-10">
          Two shortcuts share the same keys. The first one listed wins.
        </p>
      )}

      <div className="row-end mt-12">
        <button type="button" className="skin-btn secondary" onClick={onReset}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

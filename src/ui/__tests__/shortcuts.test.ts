import { describe, expect, it } from "vitest";
import {
  actionForEvent,
  bindingFromEvent,
  conflictingActions,
  DEFAULT_SHORTCUT_BINDINGS,
  isActivationKeyOnControl,
  isTypingTarget,
  matchesBinding,
  normalizeBinding,
  parseShortcutBindings,
  SHORTCUT_DEFINITIONS,
} from "../lib/shortcuts";

function keyEvent(
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
  target?: EventTarget,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, ...modifiers });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("bindingFromEvent", () => {
  it("builds a canonical chord in a fixed modifier order", () => {
    expect(
      bindingFromEvent(keyEvent("1", { ctrlKey: true, shiftKey: true })),
    ).toBe("Ctrl+Shift+1");
    expect(
      bindingFromEvent(keyEvent("s", { shiftKey: true, ctrlKey: true })),
    ).toBe("Ctrl+Shift+S");
  });

  it("upper-cases single letters so case never splits a binding", () => {
    expect(bindingFromEvent(keyEvent("f"))).toBe("F");
    expect(bindingFromEvent(keyEvent("F"))).toBe("F");
  });

  it("names the keys that have no printable form", () => {
    expect(bindingFromEvent(keyEvent(" "))).toBe("Space");
    expect(bindingFromEvent(keyEvent("ArrowUp"))).toBe("Up");
    expect(bindingFromEvent(keyEvent("Escape"))).toBe("Escape");
  });

  it("ignores a modifier pressed on its own", () => {
    expect(bindingFromEvent(keyEvent("Control", { ctrlKey: true }))).toBeNull();
    expect(bindingFromEvent(keyEvent("Shift", { shiftKey: true }))).toBeNull();
  });
});

describe("normalizeBinding", () => {
  it("reorders and re-cases whatever it is given", () => {
    expect(normalizeBinding("shift+ctrl+a")).toBe("Ctrl+Shift+A");
    expect(normalizeBinding("CMD+k")).toBe("Meta+K");
    expect(normalizeBinding(" ctrl + 1 ")).toBe("Ctrl+1");
  });

  it("leaves an already canonical binding alone", () => {
    expect(normalizeBinding("Ctrl+Shift+1")).toBe("Ctrl+Shift+1");
  });
});

describe("matchesBinding", () => {
  it("matches regardless of how the binding was written", () => {
    const event = keyEvent("2", { ctrlKey: true });
    expect(matchesBinding(event, "ctrl+2")).toBe(true);
    expect(matchesBinding(event, "Ctrl+2")).toBe(true);
    expect(matchesBinding(event, "Ctrl+Shift+2")).toBe(false);
    expect(matchesBinding(event, "")).toBe(false);
  });
});

describe("actionForEvent", () => {
  it("finds the action bound to a chord", () => {
    expect(
      actionForEvent(
        keyEvent("2", { ctrlKey: true }),
        DEFAULT_SHORTCUT_BINDINGS,
      ),
    ).toBe("page_sweep_fr");
    expect(actionForEvent(keyEvent("F"), DEFAULT_SHORTCUT_BINDINGS)).toBe(
      "reject_review",
    );
  });

  it("returns nothing for an unbound key", () => {
    expect(actionForEvent(keyEvent("Q"), DEFAULT_SHORTCUT_BINDINGS)).toBeNull();
  });

  it("stays silent while the user is typing", () => {
    const input = document.createElement("input");
    expect(
      actionForEvent(keyEvent("F", {}, input), DEFAULT_SHORTCUT_BINDINGS),
    ).toBeNull();
    const textarea = document.createElement("textarea");
    expect(
      actionForEvent(keyEvent("F", {}, textarea), DEFAULT_SHORTCUT_BINDINGS),
    ).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("recognises the editable elements", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("conflictingActions", () => {
  it("finds nothing wrong with the defaults", () => {
    expect(conflictingActions(DEFAULT_SHORTCUT_BINDINGS).size).toBe(0);
  });

  it("flags both sides of a collision", () => {
    const conflicts = conflictingActions({
      ...DEFAULT_SHORTCUT_BINDINGS,
      accept_review: "F",
    });
    expect(conflicts.has("accept_review")).toBe(true);
    expect(conflicts.has("reject_review")).toBe(true);
  });
});

describe("parseShortcutBindings", () => {
  it("returns the defaults for missing or broken storage", () => {
    expect(parseShortcutBindings(null)).toEqual(DEFAULT_SHORTCUT_BINDINGS);
    expect(parseShortcutBindings("{oops")).toEqual(DEFAULT_SHORTCUT_BINDINGS);
  });

  it("overlays stored bindings and normalises them", () => {
    const parsed = parseShortcutBindings(
      JSON.stringify({ reject_review: "shift+x", unknown_action: "Z" }),
    );
    expect(parsed.reject_review).toBe("Shift+X");
    expect(parsed.accept_review).toBe(DEFAULT_SHORTCUT_BINDINGS.accept_review);
  });

  it("covers every declared action", () => {
    for (const definition of SHORTCUT_DEFINITIONS) {
      expect(DEFAULT_SHORTCUT_BINDINGS[definition.action]).toBeTruthy();
    }
  });
});

describe("isActivationKeyOnControl", () => {
  it("claims Enter and Space on a focused button", () => {
    const button = document.createElement("button");
    expect(isActivationKeyOnControl(keyEvent("Enter", {}, button))).toBe(true);
    expect(isActivationKeyOnControl(keyEvent(" ", {}, button))).toBe(true);
  });

  it("claims Enter on links, summaries and role-bearing controls", () => {
    const link = document.createElement("a");
    const summary = document.createElement("summary");
    const custom = document.createElement("div");
    custom.setAttribute("role", "menuitem");
    expect(isActivationKeyOnControl(keyEvent("Enter", {}, link))).toBe(true);
    expect(isActivationKeyOnControl(keyEvent("Enter", {}, summary))).toBe(true);
    expect(isActivationKeyOnControl(keyEvent("Enter", {}, custom))).toBe(true);
  });

  it("leaves letter keys alone so bindings still fire from a button", () => {
    const button = document.createElement("button");
    expect(isActivationKeyOnControl(keyEvent("k", {}, button))).toBe(false);
  });

  it("ignores Enter outside any activatable control", () => {
    const box = document.createElement("div");
    expect(isActivationKeyOnControl(keyEvent("Enter", {}, box))).toBe(false);
  });
});

describe("actionForEvent activation guard", () => {
  it("does not start a test when Enter activates the focused button", () => {
    const button = document.createElement("button");
    expect(
      actionForEvent(keyEvent("Enter", {}, button), DEFAULT_SHORTCUT_BINDINGS),
    ).toBeNull();
  });

  it("still starts a test when Enter is pressed with nothing focused", () => {
    const box = document.createElement("div");
    expect(
      actionForEvent(keyEvent("Enter", {}, box), DEFAULT_SHORTCUT_BINDINGS),
    ).toBe("start_test");
  });

  it("keeps the review letter bindings working from a button", () => {
    const button = document.createElement("button");
    expect(
      actionForEvent(keyEvent("k", {}, button), DEFAULT_SHORTCUT_BINDINGS),
    ).toBe("accept_review");
  });
});

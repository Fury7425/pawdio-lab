import { useEffect, useState } from "react";
import { Modal } from "./modal";
import { CheckboxField } from "./form-fields";
import { ShortcutSettings } from "./shortcut-settings";
import { UpdateCheckPanel } from "./update-check-panel";
import { useShortcutBindings } from "../hooks/use-shortcuts";
import { usePawdioLabContext } from "../pawdio-context";
import {
  ACCENT_COLORS,
  APPEARANCE_MODES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_APPEARANCE_MODE,
  type AccentColor,
  persistDeviceUiPrefs,
  readDeviceUiPrefs,
} from "../theme";

/** Swatch fills; the same values as each `--accent` in index.css. */
const ACCENT_SWATCH: Record<AccentColor, string> = {
  Blue: "#2f7cd0",
  Teal: "#21929b",
  Greyscale: "#6e7a8b",
  Purple: "#7a65da",
};

const TABS = ["Appearance", "Shortcuts", "Updates"] as const;
type Tab = (typeof TABS)[number];

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

/** App preferences that are not about the audio devices. */
export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("Appearance");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      className="settings-modal"
      closeOnOverlay
      footer={
        <>
          <span className="muted compact-note settings-modal-note">
            Saved as you change them.
          </span>
          <button type="button" className="skin-btn" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="settings-modal-body">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className={`nav-btn${tab === name ? " is-active" : ""}`}
              aria-current={tab === name ? "true" : undefined}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="settings-tab-panel">
          {tab === "Appearance" && <AppearanceSettings />}
          {tab === "Shortcuts" && <ShortcutsTab />}
          {tab === "Updates" && <UpdateCheckPanel />}
        </div>
      </div>
    </Modal>
  );
}

function ShortcutsTab() {
  const shortcuts = useShortcutBindings();
  return (
    <ShortcutSettings
      bindings={shortcuts.bindings}
      onRebind={shortcuts.rebind}
      onReset={shortcuts.resetAll}
    />
  );
}

function AppearanceSettings() {
  const ctx = usePawdioLabContext();
  const [prefs, setPrefs] = useState(
    () =>
      readDeviceUiPrefs() ?? {
        appearanceMode: DEFAULT_APPEARANCE_MODE,
        accentColor: DEFAULT_ACCENT_COLOR,
      },
  );

  useEffect(() => {
    persistDeviceUiPrefs(prefs);
  }, [prefs]);

  return (
    <section className="page-section">
      <h3 className="section-subheading">Theme</h3>
      <div className="segmented" role="group" aria-label="Theme">
        {APPEARANCE_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`segmented-btn${prefs.appearanceMode === mode ? " is-active" : ""}`}
            aria-pressed={prefs.appearanceMode === mode}
            onClick={() =>
              setPrefs((prev) => ({ ...prev, appearanceMode: mode }))
            }
          >
            {mode}
          </button>
        ))}
      </div>

      <h3 className="section-subheading mt-20">Accent</h3>
      <div className="swatch-row" role="group" aria-label="Accent color">
        {ACCENT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch-btn${prefs.accentColor === color ? " is-active" : ""}`}
            aria-pressed={prefs.accentColor === color}
            onClick={() =>
              setPrefs((prev) => ({ ...prev, accentColor: color }))
            }
          >
            <span
              className="swatch-dot"
              style={{ background: ACCENT_SWATCH[color] }}
              aria-hidden="true"
            />
            {color}
          </button>
        ))}
      </div>

      <hr className="section-divider" />
      <CheckboxField
        label="Show experimental tests"
        checked={ctx.experimentalEnabled}
        onChange={ctx.setExperimentalEnabled}
      />
      <p className="muted compact-note mt-8">
        Adds Balance, Crosstalk and THD under Tests in the sidebar.
      </p>
    </section>
  );
}

import {
  Timer,
  AudioWaveform,
  EarOff,
  Speaker,
  FileText,
  FlaskConical,
  Library,
  SlidersHorizontal,
} from "lucide-react";
import { pageItems, PageKey, type PageGroup } from "../model";
import { usePawdioLabContext } from "../pawdio-context";
import { useShortcutBindings } from "../hooks/use-shortcuts";
import type { ShortcutAction } from "../lib/shortcuts";

const PAGE_ICONS: Record<
  PageKey,
  React.ComponentType<{ size?: number | string }>
> = {
  latency: Timer,
  sweep_fr: AudioWaveform,
  anc: EarOff,
  devices: Speaker,
  results: FileText,
  library: Library,
  experimental: FlaskConical,
};

const GROUPS: PageGroup[] = ["Tests", "Data", "Setup"];

type SidebarProps = {
  onOpenSettings: () => void;
};

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const ctx = usePawdioLabContext();
  const { bindings } = useShortcutBindings();
  const visiblePages = ctx.experimentalEnabled
    ? pageItems
    : pageItems.filter((item) => item.key !== "experimental");

  return (
    <aside className="sidebar-shell">
      <h1 className="sidebar-title">PawdioLab</h1>
      <p className="sidebar-subtitle">Audio Diagnostics</p>

      <nav className="sidebar-nav" aria-label="Primary">
        {GROUPS.map((group) => (
          <div key={group} className="nav-group">
            <p className="nav-group-label">{group}</p>
            {visiblePages
              .filter((item) => item.group === group)
              .map((item) => {
                const Icon = PAGE_ICONS[item.key];
                const binding = bindings[`page_${item.key}` as ShortcutAction];
                const active = ctx.activePage === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`nav-btn${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    title={binding ? `${item.label} (${binding})` : item.label}
                    onClick={() => ctx.setActivePage(item.key)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                    {binding && (
                      <kbd className="nav-kbd" aria-hidden="true">
                        {binding}
                      </kbd>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="status-pill" aria-live="polite" aria-atomic="true">
          <span
            className={`status-dot ${ctx.running ? "running" : "idle"}`}
            aria-hidden="true"
          />
          {ctx.running ? "Running" : "Idle"}
        </span>
        <button
          type="button"
          className="icon-btn sidebar-settings-btn"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
        </button>
        <span className="sidebar-version">v{__APP_VERSION__}</span>
      </div>
    </aside>
  );
}

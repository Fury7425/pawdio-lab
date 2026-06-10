import {
  Timer,
  AudioWaveform,
  EarOff,
  Settings,
  FileText,
  FlaskConical,
  Library,
} from "lucide-react";
import { pageItems, PageKey } from "../model";
import { usePawdioLabContext } from "../pawdio-context";

const PAGE_ICONS: Record<
  PageKey,
  React.ComponentType<{ size?: number | string }>
> = {
  latency: Timer,
  sweep_fr: AudioWaveform,
  anc: EarOff,
  devices: Settings,
  results: FileText,
  library: Library,
  experimental: FlaskConical,
};

export function Sidebar() {
  const ctx = usePawdioLabContext();
  const visiblePages = ctx.experimentalEnabled
    ? pageItems
    : pageItems.filter((item) => item.key !== "experimental");

  return (
    <aside className="sidebar-shell">
      <h1 className="sidebar-title">PawdioLab</h1>
      <p className="sidebar-subtitle">Audio Diagnostics</p>

      <nav className="sidebar-nav" aria-label="Primary">
        {visiblePages.map((item, index) => {
          const Icon = PAGE_ICONS[item.key];
          return (
            <button
              key={item.key}
              type="button"
              className={`nav-btn${ctx.activePage === item.key ? " is-active" : ""}`}
              aria-current={ctx.activePage === item.key ? "page" : undefined}
              aria-label={item.label}
              title={`${item.label} (Ctrl+${index + 1})`}
              onClick={() => ctx.setActivePage(item.key)}
            >
              <Icon size={16} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
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
          className="skin-btn danger"
          disabled={!ctx.running}
          aria-label="Stop current test"
          onClick={() => ctx.run(ctx.stopTest())}
        >
          Stop
        </button>
        <span className="sidebar-version">v{__APP_VERSION__}</span>
      </div>
    </aside>
  );
}

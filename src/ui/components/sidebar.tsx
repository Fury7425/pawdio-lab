import {
  Timer,
  AudioWaveform,
  Settings,
  FileText,
  FlaskConical,
} from "lucide-react";
import { pageItems, PageKey } from "../model";

const PAGE_ICONS: Record<PageKey, React.ComponentType<{ size?: number | string }>> = {
  latency: Timer,
  sweep_fr: AudioWaveform,
  devices: Settings,
  results: FileText,
  experimental: FlaskConical,
};

type SidebarProps = {
  activePage: PageKey;
  running: boolean;
  experimentalEnabled: boolean;
  onSelectPage: (page: PageKey) => void;
  onRefreshDevices: () => void;
  onStopTest: () => void;
};

export function Sidebar({
  activePage,
  running,
  experimentalEnabled,
  onSelectPage,
  onStopTest,
}: SidebarProps) {
  const visiblePages = experimentalEnabled
    ? pageItems
    : pageItems.filter((item) => item.key !== "experimental");

  return (
    <aside className="sidebar-shell">
      <h1 className="sidebar-title">PawdioLab</h1>
      <p className="sidebar-subtitle">Audio Diagnostics</p>

      <nav className="sidebar-nav" aria-label="Primary">
        {visiblePages.map((item) => {
          const Icon = PAGE_ICONS[item.key];
          return (
            <button
              key={item.key}
              type="button"
              className={`nav-btn${activePage === item.key ? " is-active" : ""}`}
              onClick={() => onSelectPage(item.key)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span className="status-pill">
          <span className={`status-dot ${running ? "running" : "idle"}`} />
          {running ? "Running" : "Idle"}
        </span>
        <button
          type="button"
          className="skin-btn danger"
          disabled={!running}
          onClick={onStopTest}
        >
          Stop
        </button>
      </div>
    </aside>
  );
}

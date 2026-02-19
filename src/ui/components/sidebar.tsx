import { pageItems, PageKey } from "../model";

type SidebarProps = {
  activePage: PageKey;
  running: boolean;
  onSelectPage: (page: PageKey) => void;
  onRefreshDevices: () => void;
  onStopTest: () => void;
};

export function Sidebar({
  activePage,
  running,
  onSelectPage,
  onRefreshDevices,
  onStopTest
}: SidebarProps) {
  return (
    <aside className="sidebar-shell">
      <h1 className="sidebar-title">PawdioLab</h1>
      <p className="sidebar-subtitle">Desktop Audio Diagnostics</p>

      <nav className="sidebar-nav" aria-label="Primary">
        {pageItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-btn ${activePage === item.key ? "is-active" : ""}`.trim()}
            onClick={() => onSelectPage(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="status-pill">
          <span className={`status-dot ${running ? "running" : "idle"}`} />
          {running ? "Running" : "Idle"}
        </span>
        <button type="button" className="skin-btn secondary" onClick={onRefreshDevices}>
          Refresh Devices
        </button>
        <button type="button" className="skin-btn danger" disabled={!running} onClick={onStopTest}>
          Stop Test
        </button>
      </div>
    </aside>
  );
}

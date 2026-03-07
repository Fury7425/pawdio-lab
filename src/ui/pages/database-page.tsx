import { useState, useMemo } from "react";
import { ResultEntry, legacyTimestamp } from "../model";

type DatabasePageProps = {
  results: ResultEntry[];
  onDeleteResult: (id: number) => void;
  onClearAllResults: () => void;
};

// Group results by device name
type DeviceGroup = {
  deviceName: string;
  results: ResultEntry[];
};

export function DatabasePage({
  results,
  onDeleteResult,
  onClearAllResults,
}: DatabasePageProps) {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"text" | "image">("text");

  // Group results by device name
  const deviceGroups: DeviceGroup[] = useMemo(() => {
    const filtered = results.filter((entry) => {
      if (filterType === "all") return true;
      return entry.payload.test === filterType;
    });

    // Group by device name
    const groups: Record<string, ResultEntry[]> = {};
    for (const entry of filtered) {
      const deviceName = entry.deviceName || "Unknown Device";
      if (!groups[deviceName]) {
        groups[deviceName] = [];
      }
      groups[deviceName].push(entry);
    }

    // Sort devices alphabetically
    const sortedDevices = Object.keys(groups).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    return sortedDevices.map((deviceName) => ({
      deviceName,
      results: groups[deviceName],
    }));
  }, [results, filterType]);

  // Get selected result
  const selectedResult = useMemo(() => {
    return results.find((r) => r.id === selectedResultId) || null;
  }, [results, selectedResultId]);

  // Get test types for filter dropdown
  const testTypes = Array.from(
    new Set(results.map((r) => r.payload.test))
  );

  const formatDate = (timestamp: string | number | undefined) => {
    if (!timestamp) return "Unknown";
    if (typeof timestamp === "number") {
      return new Date(timestamp).toLocaleString();
    }
    return legacyTimestamp(timestamp);
  };

  const getTestTypeLabel = (test: string) => {
    switch (test) {
      case "latency":
        return "Latency";
      case "sweep_fr":
        return "Sweep FR";
      case "balance":
        return "Balance";
      case "crosstalk":
        return "Crosstalk";
      case "thd":
        return "THD";
      case "isolation":
        return "Isolation";
      default:
        return test;
    }
  };

  const getMetricsSummary = (entry: ResultEntry) => {
    const metrics = entry.payload.metrics as Record<string, unknown>;
    if (!metrics) return "";

    if (entry.payload.test === "latency") {
      const avg = metrics.average_delay_ms;
      const std = metrics.std_dev_ms;
      if (avg !== undefined) {
        return `Avg: ${typeof avg === "number" ? avg.toFixed(2) : avg}ms${
          std !== undefined ? ` ±${typeof std === "number" ? std.toFixed(2) : std}ms` : ""
        }`;
      }
    }

    if (entry.payload.test === "sweep_fr") {
      const left = metrics.delay_ms_left;
      const right = metrics.delay_ms_right;
      if (left !== undefined || right !== undefined) {
        return `L: ${left !== undefined ? (typeof left === "number" ? left.toFixed(1) : left) : "-"}ms | R: ${right !== undefined ? (typeof right === "number" ? right.toFixed(1) : right) : "-"}ms`;
      }
    }

    if (entry.payload.test === "thd") {
      const thd = metrics.thd_percent;
      if (thd !== undefined) {
        return `THD: ${typeof thd === "number" ? thd.toFixed(3) : thd}%`;
      }
    }

    if (entry.payload.test === "balance") {
      const delta = metrics.l_minus_r_db;
      if (delta !== undefined) {
        return `L-R: ${typeof delta === "number" ? delta.toFixed(2) : delta} dB`;
      }
    }

    if (entry.payload.test === "crosstalk") {
      const xt = metrics.crosstalk_db;
      if (xt !== undefined) {
        return `Crosstalk: ${typeof xt === "number" ? xt.toFixed(1) : xt} dB`;
      }
    }

    if (entry.payload.test === "isolation") {
      const delta = metrics.delta_db;
      if (delta !== undefined) {
        return `Isolation: ${typeof delta === "number" ? delta.toFixed(1) : delta} dB`;
      }
    }

    return JSON.stringify(metrics).slice(0, 50);
  };

  // Sort results by date (newest first) for a device
  const sortByDate = (entries: ResultEntry[]) => {
    return [...entries].sort((a, b) => {
      const timeA = a.savedAt || 0;
      const timeB = b.savedAt || 0;
      return timeB - timeA; // newest first
    });
  };

  // Calculate total results count
  const totalResults = results.length;
  const filteredResults = filterType === "all" 
    ? totalResults 
    : results.filter(r => r.payload.test === filterType).length;

  // Check if result has image data
  const hasImageData = (entry: ResultEntry) => {
    const data = entry.payload.data as Record<string, unknown>;
    return data && (
      (Array.isArray(data.freqs) && data.freqs.length > 0) ||
      (Array.isArray(data.left_mag_db_avg) && data.left_mag_db_avg.length > 0) ||
      (Array.isArray(data.right_mag_db_avg) && data.right_mag_db_avg.length > 0)
    );
  };

  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Results Database</h2>
        
        <div className="db-controls">
          <div className="db-filter">
            <label className="field-label">Filter by Type:</label>
            <select
              className="skin-select"
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setSelectedDevice(null);
                setSelectedResultId(null);
              }}
            >
              <option value="all">All Tests</option>
              {testTypes.map((type) => (
                <option key={type} value={type}>
                  {getTestTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          
          <div className="db-stats">
            <span className="db-count">{filteredResults} of {totalResults} results</span>
          </div>
        </div>

        <div className="db-layout">
          {/* Left Panel - Device List or Test List */}
          <div className="db-list-panel">
            {!selectedDevice ? (
              // Show device list
              <div className="db-list">
                {deviceGroups.length === 0 ? (
                  <div className="db-empty">
                    {results.length === 0 
                      ? "No saved results yet. Run some tests to populate the database."
                      : "No results match the current filter."
                    }
                  </div>
                ) : (
                  deviceGroups.map((group) => (
                    <div
                      key={group.deviceName}
                      className="db-item db-device-item"
                      onClick={() => setSelectedDevice(group.deviceName)}
                    >
                      <div className="db-item-header">
                        <span className="db-device-name">{group.deviceName}</span>
                        <span className="db-count-badge">{group.results.length}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Show test list for selected device
              <div className="db-list">
                <div className="db-breadcrumb">
                  <button 
                    type="button" 
                    className="db-back-btn"
                    onClick={() => {
                      setSelectedDevice(null);
                      setSelectedResultId(null);
                    }}
                  >
                    ← Back to Devices
                  </button>
                  <span className="db-current-device">{selectedDevice}</span>
                </div>
                {sortByDate(
                  deviceGroups.find(g => g.deviceName === selectedDevice)?.results || []
                ).map((entry) => (
                  <div
                    key={entry.id}
                    className={`db-item ${selectedResultId === entry.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedResultId(entry.id)}
                  >
                    <div className="db-item-header">
                      <span className={`db-badge db-badge-${entry.payload.test}`}>
                        {getTestTypeLabel(entry.payload.test)}
                      </span>
                      <span className="db-date">
                        {formatDate(entry.savedAt || entry.payload.timestamp)}
                      </span>
                    </div>
                    <div className="db-item-metrics">
                      {getMetricsSummary(entry)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {results.length > 0 && (
              <div className="db-list-footer">
                <button
                  type="button"
                  className="skin-btn secondary"
                  onClick={onClearAllResults}
                >
                  Clear All Results
                </button>
              </div>
            )}
          </div>

          {/* Right Panel - Result Details */}
          <div className="db-detail-panel">
            {selectedResult ? (
              <>
                <div className="db-detail-header">
                  <h3 className="db-detail-title">
                    {getTestTypeLabel(selectedResult.payload.test)} Result
                    <span className="db-detail-id">#{selectedResult.id}</span>
                  </h3>
                  <div className="db-detail-actions">
                    {hasImageData(selectedResult) && (
                      <div className="db-view-toggle">
                        <button
                          type="button"
                          className={`toggle-btn ${viewMode === "text" ? "active" : ""}`}
                          onClick={() => setViewMode("text")}
                        >
                          Text
                        </button>
                        <button
                          type="button"
                          className={`toggle-btn ${viewMode === "image" ? "active" : ""}`}
                          onClick={() => setViewMode("image")}
                        >
                          Image
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="skin-btn danger"
                      onClick={() => {
                        onDeleteResult(selectedResult.id);
                        setSelectedResultId(null);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                
                <div className="db-detail-content">
                  {viewMode === "image" && hasImageData(selectedResult) ? (
                    <div className="db-detail-section">
                      <h4>Frequency Response</h4>
                      <div className="db-image-placeholder">
                        <p>Frequency response visualization would be rendered here.</p>
                        <p className="muted-text">
                          (Chart rendering requires chart library integration)
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="db-detail-section">
                        <h4>Device</h4>
                        <p>{selectedResult.deviceName || "Unknown Device"}</p>
                      </div>
                      
                      <div className="db-detail-section">
                        <h4>Timestamp</h4>
                        <p>{formatDate(selectedResult.savedAt || selectedResult.payload.timestamp)}</p>
                      </div>
                      
                      <div className="db-detail-section">
                        <h4>Parameters</h4>
                        <pre className="mono-pre">
                          {JSON.stringify(selectedResult.payload.params, null, 2)}
                        </pre>
                      </div>
                      
                      <div className="db-detail-section">
                        <h4>Metrics</h4>
                        <pre className="mono-pre">
                          {JSON.stringify(selectedResult.payload.metrics, null, 2)}
                        </pre>
                      </div>
                      
                      {selectedResult.payload.data &&
                        Object.keys(selectedResult.payload.data).length > 0 && (
                          <div className="db-detail-section">
                            <h4>Data</h4>
                            <pre className="mono-pre">
                              {JSON.stringify(selectedResult.payload.data, null, 2)}
                            </pre>
                          </div>
                        )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="db-detail-empty">
                {selectedDevice 
                  ? "Select a test from the list to view details"
                  : "Select a device from the list to view tests"
                }
              </div>
            )}
          </div>
        </div>
      </section>

      <style>{`
        .db-controls {
          display: flex;
          gap: 16px;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        
        .db-filter {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .db-filter .field-label {
          margin: 0;
        }
        
        .skin-select {
          padding: 6px 12px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: var(--bg-color);
          color: var(--text-color);
          font-size: 13px;
        }
        
        .db-stats {
          margin-left: auto;
        }
        
        .db-count {
          font-size: 13px;
          color: var(--muted-color);
        }
        
        .db-layout {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 16px;
          min-height: 450px;
        }
        
        .db-list-panel {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .db-list {
          flex: 1;
          overflow-y: auto;
          max-height: 420px;
        }
        
        .db-empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--muted-color);
          font-size: 13px;
        }
        
        .db-item {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          cursor: pointer;
          transition: background 0.15s;
        }
        
        .db-item:hover {
          background: var(--hover-bg);
        }
        
        .db-item.is-selected {
          background: var(--accent-bg);
          border-left: 3px solid var(--accent-color);
        }
        
        .db-device-item {
          background: var(--card-bg);
        }
        
        .db-device-item:hover {
          background: var(--hover-bg);
        }
        
        .db-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        
        .db-device-name {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-color);
        }
        
        .db-count-badge {
          background: var(--accent-color);
          color: white;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 10px;
        }
        
        .db-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        
        .db-badge-latency { background: #3b82f6; color: white; }
        .db-badge-sweep_fr { background: #10b981; color: white; }
        .db-badge-balance { background: #f59e0b; color: white; }
        .db-badge-crosstalk { background: #8b5cf6; color: white; }
        .db-badge-thd { background: #ef4444; color: white; }
        .db-badge-isolation { background: #06b6d4; color: white; }
        
        .db-date {
          font-size: 11px;
          color: var(--muted-color);
        }
        
        .db-item-metrics {
          font-size: 12px;
          color: var(--text-color);
        }
        
        .db-list-footer {
          padding: 12px;
          border-top: 1px solid var(--border-color);
          background: var(--card-bg);
        }
        
        .db-breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          background: var(--card-bg);
        }
        
        .db-back-btn {
          background: none;
          border: none;
          color: var(--accent-color);
          cursor: pointer;
          font-size: 13px;
          padding: 4px 8px;
          border-radius: 4px;
        }
        
        .db-back-btn:hover {
          background: var(--hover-bg);
        }
        
        .db-current-device {
          font-weight: 600;
          font-size: 13px;
          color: var(--text-color);
        }
        
        .skin-btn.danger {
          background: #ef4444;
          color: white;
          border: none;
        }
        
        .skin-btn.danger:hover {
          background: #dc2626;
        }
        
        .db-detail-panel {
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        
        .db-detail-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--card-bg);
          border-bottom: 1px solid var(--border-color);
          flex-wrap: wrap;
          gap: 12px;
        }
        
        .db-detail-title {
          font-weight: 600;
          font-size: 15px;
          margin: 0;
        }
        
        .db-detail-id {
          font-weight: normal;
          color: var(--muted-color);
          font-size: 13px;
          margin-left: 8px;
        }
        
        .db-detail-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .db-view-toggle {
          display: flex;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          overflow: hidden;
        }
        
        .toggle-btn {
          padding: 6px 12px;
          background: var(--bg-color);
          border: none;
          color: var(--text-color);
          font-size: 12px;
          cursor: pointer;
          transition: background 0.15s;
        }
        
        .toggle-btn:first-child {
          border-right: 1px solid var(--border-color);
        }
        
        .toggle-btn.active {
          background: var(--accent-color);
          color: white;
        }
        
        .toggle-btn:hover:not(.active) {
          background: var(--hover-bg);
        }
        
        .db-detail-content {
          padding: 16px;
          flex: 1;
          overflow-y: auto;
          max-height: 450px;
        }
        
        .db-detail-section {
          margin-bottom: 20px;
        }
        
        .db-detail-section h4 {
          font-size: 11px;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: var(--muted-color);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .db-detail-section p {
          margin: 0;
          font-size: 13px;
        }
        
        .db-detail-section .mono-pre {
          font-size: 11px;
          background: var(--code-bg);
          padding: 10px;
          border-radius: 6px;
          overflow-x: auto;
          max-height: 150px;
          margin: 0;
        }
        
        .db-detail-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 200px;
          color: var(--muted-color);
          font-size: 14px;
        }
        
        .db-image-placeholder {
          background: var(--code-bg);
          border-radius: 6px;
          padding: 32px;
          text-align: center;
          color: var(--muted-color);
        }
        
        .db-image-placeholder .muted-text {
          font-size: 12px;
          margin-top: 8px;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}


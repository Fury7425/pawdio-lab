import { useState } from "react";
import { ResultEntry, legacyTimestamp } from "../model";

type DatabasePageProps = {
  results: ResultEntry[];
  onDeleteResult: (id: number) => void;
  onClearAllResults: () => void;
};

export function DatabasePage({
  results,
  onDeleteResult,
  onClearAllResults,
}: DatabasePageProps) {
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const selectedResult = results.find((r) => r.id === selectedResultId) || null;

  const filteredResults = results
    .filter((entry) => {
      if (filterType === "all") return true;
      return entry.payload.test === filterType;
    })
    .sort((a, b) => {
      const timeA = a.savedAt || 0;
      const timeB = b.savedAt || 0;
      return sortOrder === "newest" ? timeB - timeA : timeA - timeB;
    });

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
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">All Tests</option>
              {testTypes.map((type) => (
                <option key={type} value={type}>
                  {getTestTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          
          <div className="db-sort">
            <label className="field-label">Sort:</label>
            <select
              className="skin-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
          
          <div className="db-stats">
            <span className="db-count">{filteredResults.length} of {results.length} results</span>
          </div>
        </div>

        <div className="db-layout">
          <div className="db-list-panel">
            <div className="db-list">
              {filteredResults.length === 0 ? (
                <div className="db-empty">
                  {results.length === 0 
                    ? "No saved results yet. Run some tests to populate the database."
                    : "No results match the current filter."
                  }
                </div>
              ) : (
                filteredResults.map((entry) => (
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
                ))
              )}
            </div>
            
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

          <div className="db-detail-panel">
            {selectedResult ? (
              <>
                <div className="db-detail-header">
                  <h3 className="db-detail-title">
                    {getTestTypeLabel(selectedResult.payload.test)} Result
                    <span className="db-detail-id">#{selectedResult.id}</span>
                  </h3>
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
                
                <div className="db-detail-content">
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
                </div>
              </>
            ) : (
              <div className="db-detail-empty">
                Select a result from the list to view details
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
        
        .db-filter, .db-sort {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .db-filter .field-label, .db-sort .field-label {
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
        
        .db-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
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
      `}</style>
    </div>
  );
}


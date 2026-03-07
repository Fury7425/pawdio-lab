import { useState } from "react";
import { ResultEntry, legacyTimestamp } from "../model";

type ResultsPageProps = {
  resultText: string;
  logText: string;
  results: ResultEntry[];
  onCopyLog: () => void;
  onClearLog: () => void;
  onClearResults: () => void;
  onDeleteResult: (id: number) => void;
  onRestoreResult: (entry: ResultEntry) => void;
};

type TabType = "json" | "log" | "database";

export function ResultsPage({
  resultText,
  logText,
  results,
  onCopyLog,
  onClearLog,
  onClearResults,
  onDeleteResult,
  onRestoreResult,
}: ResultsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>("database");
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);

  const selectedResult = results.find((r) => r.id === selectedResultId) || null;

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

    return JSON.stringify(metrics).slice(0, 50);
  };

  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Results / Export</h2>

        {/* Tab Navigation */}
        <div className="tab-nav" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`tab-btn ${activeTab === "database" ? "is-active" : ""}`}
            onClick={() => setActiveTab("database")}
          >
            Database ({results.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "json" ? "is-active" : ""}`}
            onClick={() => setActiveTab("json")}
          >
            JSON View
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "log" ? "is-active" : ""}`}
            onClick={() => setActiveTab("log")}
          >
            Logs
          </button>
        </div>

        {/* Database Tab */}
        {activeTab === "database" && (
          <div className="database-layout">
            {/* Results List */}
            <div className="results-list-panel">
              <div className="results-list-header">
                <span className="results-list-title">Saved Results</span>
                <span className="results-list-count">{results.length} entries</span>
              </div>
              <div className="results-list">
                {results.length === 0 ? (
                  <div className="results-empty">
                    No saved results yet. Run some tests to see them here.
                  </div>
                ) : (
                  results.map((entry) => (
                    <div
                      key={entry.id}
                      className={`result-item ${
                        selectedResultId === entry.id ? "is-selected" : ""
                      }`}
                      onClick={() => setSelectedResultId(entry.id)}
                    >
                      <div className="result-item-header">
                        <span className="result-item-type">
                          {getTestTypeLabel(entry.payload.test)}
                        </span>
                        <span className="result-item-date">
                          {formatDate(entry.savedAt || entry.payload.timestamp)}
                        </span>
                      </div>
                      <div className="result-item-metrics">
                        {getMetricsSummary(entry)}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="results-list-actions">
                <button
                  type="button"
                  className="skin-btn secondary"
                  onClick={onClearResults}
                  disabled={results.length === 0}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Result Detail Panel */}
            <div className="results-detail-panel">
              {selectedResult ? (
                <>
                  <div className="result-detail-header">
                    <h3 className="result-detail-title">
                      {getTestTypeLabel(selectedResult.payload.test)} Result
                    </h3>
                    <button
                      type="button"
                      className="skin-btn secondary"
                      onClick={() => {
                        onDeleteResult(selectedResult.id);
                        setSelectedResultId(null);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="result-detail-content">
                    <div className="result-detail-section">
                      <h4>Parameters</h4>
                      <pre className="mono-pre small">
                        {JSON.stringify(selectedResult.payload.params, null, 2)}
                      </pre>
                    </div>
                    <div className="result-detail-section">
                      <h4>Metrics</h4>
                      <pre className="mono-pre small">
                        {JSON.stringify(selectedResult.payload.metrics, null, 2)}
                      </pre>
                    </div>
                    {selectedResult.payload.data &&
                      Object.keys(selectedResult.payload.data).length > 0 && (
                        <div className="result-detail-section">
                          <h4>Data</h4>
                          <pre className="mono-pre small">
                            {JSON.stringify(selectedResult.payload.data, null, 2)}
                          </pre>
                        </div>
                      )}
                  </div>
                </>
              ) : (
                <div className="result-detail-empty">
                  Select a result from the list to view details
                </div>
              )}
            </div>
          </div>
        )}

        {/* JSON View Tab */}
        {activeTab === "json" && (
          <section className="page-card">
            <h3 className="section-subheading">Results Output</h3>
            <div className="scroll-box">
              <pre className="mono-pre">
                {resultText.length > 0 ? resultText : "No test results yet."}
              </pre>
            </div>
          </section>
        )}

        {/* Log Tab */}
        {activeTab === "log" && (
          <section className="page-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <h3 className="section-subheading" style={{ marginBottom: 0 }}>
                Results / Log
              </h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="skin-btn secondary"
                  onClick={onCopyLog}
                >
                  Copy Log
                </button>
                <button
                  type="button"
                  className="skin-btn secondary"
                  onClick={onClearLog}
                >
                  Clear Log
                </button>
              </div>
            </div>

            <div className="scroll-box" style={{ marginTop: 10 }}>
              <pre className="mono-pre">
                {logText.length > 0 ? logText : "No logs yet."}
              </pre>
            </div>
          </section>
        )}
      </section>

      <style>{`
        .tab-nav {
          display: flex;
          gap: 4px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 8px;
        }
        .tab-btn {
          padding: 8px 16px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          color: var(--text-color);
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        .tab-btn:hover {
          background: var(--hover-bg);
        }
        .tab-btn.is-active {
          background: var(--accent-bg);
          border-color: var(--accent-color);
          color: var(--accent-color);
        }
        
        .database-layout {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 16px;
          min-height: 400px;
        }
        
        .results-list-panel {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .results-list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: var(--card-bg);
          border-bottom: 1px solid var(--border-color);
        }
        
        .results-list-title {
          font-weight: 600;
          font-size: 14px;
        }
        
        .results-list-count {
          font-size: 12px;
          color: var(--muted-color);
        }
        
        .results-list {
          flex: 1;
          overflow-y: auto;
          max-height: 350px;
        }
        
        .results-empty {
          padding: 24px;
          text-align: center;
          color: var(--muted-color);
          font-size: 13px;
        }
        
        .result-item {
          padding: 12px;
          border-bottom: 1px solid var(--border-color);
          cursor: pointer;
          transition: background 0.2s;
        }
        .result-item:hover {
          background: var(--hover-bg);
        }
        .result-item.is-selected {
          background: var(--accent-bg);
          border-left: 3px solid var(--accent-color);
        }
        
        .result-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        
        .result-item-type {
          font-weight: 600;
          font-size: 13px;
          color: var(--accent-color);
        }
        
        .result-item-date {
          font-size: 11px;
          color: var(--muted-color);
        }
        
        .result-item-metrics {
          font-size: 12px;
          color: var(--text-color);
        }
        
        .results-list-actions {
          padding: 12px;
          border-top: 1px solid var(--border-color);
          background: var(--card-bg);
        }
        
        .results-detail-panel {
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .result-detail-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: var(--card-bg);
          border-bottom: 1px solid var(--border-color);
        }
        
        .result-detail-title {
          font-weight: 600;
          font-size: 14px;
          margin: 0;
        }
        
        .result-detail-content {
          padding: 12px;
          max-height: 400px;
          overflow-y: auto;
        }
        
        .result-detail-section {
          margin-bottom: 16px;
        }
        
        .result-detail-section h4 {
          font-size: 12px;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: var(--muted-color);
          text-transform: uppercase;
        }
        
        .mono-pre.small {
          font-size: 11px;
          background: var(--code-bg);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          max-height: 150px;
        }
        
        .result-detail-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--muted-color);
        }
      `}</style>
    </div>
  );
}


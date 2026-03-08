import { useState, useMemo, useEffect, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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

// Group results by test type for a device
type TestTypeGroup = {
  testType: string;
  results: ResultEntry[];
  latestTimestamp: number;
  count: number;
};

const STORAGE_KEY = "pawdio_lab_database_results";

// Test type constants - centralized for maintainability
const TEST_TYPES = {
  LATENCY: "latency",
  SWEEP_FR: "sweep_fr",
  BALANCE: "balance",
  CROSSTALK: "crosstalk",
  THD: "thd",
  ISOLATION: "isolation",
} as const;

type TestTypeKey = typeof TEST_TYPES[keyof typeof TEST_TYPES];

const TEST_TYPE_LABELS: Record<string, string> = {
  [TEST_TYPES.LATENCY]: "Latency",
  [TEST_TYPES.SWEEP_FR]: "Sweep FR",
  [TEST_TYPES.BALANCE]: "Balance",
  [TEST_TYPES.CROSSTALK]: "Crosstalk",
  [TEST_TYPES.THD]: "THD",
  [TEST_TYPES.ISOLATION]: "Isolation",
};

const UNKNOWN_DEVICE = "Unknown Device";

// Utility to safely escape HTML to prevent XSS
const escapeHtml = (str: string): string => {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
};

// Utility to safely render JSON with XSS protection
const safeStringify = (obj: unknown, maxLength = 200): string => {
  try {
    const json = JSON.stringify(obj, null, 2);
    if (json.length > maxLength) {
      return escapeHtml(json.slice(0, maxLength)) + "...";
    }
    return escapeHtml(json);
  } catch {
    return "";
  }
};

// Image file keys that we want to display in the gallery
const IMAGE_FILE_KEYS = [
  "plot_left_avg",
  "plot_left_all",
  "plot_right_avg",
  "plot_right_all",
  "plot_all",
  "plot_lr_avg",
  "plot_avg_all",
  "overall_bar",
  "latency_report",
] as const;

// Display names for image types
const IMAGE_KEY_LABELS: Record<string, string> = {
  plot_left_avg: "Left Average",
  plot_left_all: "Left All Sweeps",
  plot_right_avg: "Right Average",
  plot_right_all: "Right All Sweeps",
  plot_all: "All Sweeps",
  plot_lr_avg: "L+R Average",
  plot_avg_all: "Average All",
  overall_bar: "Overall Bar Chart",
  latency_report: "Latency Report",
};

// Extract available image paths from payload.files
const getImagePaths = (files: Record<string, unknown> | undefined): Array<{ key: string; path: string; label: string }> => {
  if (!files) return [];
  
  const images: Array<{ key: string; path: string; label: string }> = [];
  
  for (const key of IMAGE_FILE_KEYS) {
    const value = files[key];
    if (typeof value === "string" && value.length > 0) {
      images.push({
        key,
        path: value,
        label: IMAGE_KEY_LABELS[key] || key,
      });
    }
  }
  
  return images;
};

export function DatabasePage({
  results,
  onDeleteResult,
  onClearAllResults,
}: DatabasePageProps) {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [selectedTestTypeGroup, setSelectedTestTypeGroup] = useState<TestTypeGroup | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"text" | "image">("text");
  const [loadedImages, setLoadedImages] = useState<Record<string, string>>({});
  const [imagesLoading, setImagesLoading] = useState<Record<string, boolean>>({});

  // Persist results to localStorage with quota handling
  useEffect(() => {
    if (results.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
      } catch (err) {
        // Handle quota exceeded or other localStorage errors
        if (err instanceof DOMException && err.name === "QuotaExceededError") {
          console.error("localStorage quota exceeded. Consider clearing old results.");
        } else {
          console.error("Failed to save results to localStorage:", err);
        }
      }
    }
  }, [results]);

  // Group results by device name - use useMemo for performance
  const deviceGroups: DeviceGroup[] = useMemo(() => {
    const filtered = results.filter((entry) => {
      if (filterType === "all") return true;
      return entry.payload?.test === filterType;
    });

    // Group by device name
    const groups: Record<string, ResultEntry[]> = {};
    for (const entry of filtered) {
      const deviceName = entry.deviceName || UNKNOWN_DEVICE;
      if (!groups[deviceName]) {
        groups[deviceName] = [];
      }
      groups[deviceName].push(entry);
    }

    // Sort devices alphabetically
    const sortedDevices = Object.keys(groups).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    return sortedDevices.map((deviceName) => ({
      deviceName,
      results: groups[deviceName],
    }));
  }, [results, filterType]);

  // Group results by test type for a specific device - memoized
  const getTestTypeGroups = useCallback((entries: ResultEntry[]): TestTypeGroup[] => {
    const groups: Record<string, ResultEntry[]> = {};
    
    for (const entry of entries) {
      const testType = entry.payload?.test || "unknown";
      if (!groups[testType]) {
        groups[testType] = [];
      }
      groups[testType].push(entry);
    }
    
    return Object.entries(groups).map(([testType, testResults]) => {
      // Sort by timestamp descending to get the most recent
      const sorted = [...testResults].sort((a, b) => {
        const timeA = a.savedAt || 0;
        const timeB = b.savedAt || 0;
        return timeB - timeA;
      });
      return {
        testType,
        results: sorted,
        latestTimestamp: sorted[0]?.savedAt || 0,
        count: testResults.length,
      };
    }).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  }, []);

  // Get test type groups for current device
  const currentDeviceResults = useMemo(() => {
    if (!selectedDevice) return [];
    const group = deviceGroups.find((g) => g.deviceName === selectedDevice);
    return group?.results || [];
  }, [selectedDevice, deviceGroups]);

  const testTypeGroups = useMemo(() => {
    return getTestTypeGroups(currentDeviceResults);
  }, [currentDeviceResults]);

  // Get selected result
  const selectedResult = useMemo(() => {
    return results.find((r) => r.id === selectedResultId) || null;
  }, [results, selectedResultId]);

  // Load images when switching to image view or when selected result changes
  useEffect(() => {
    if (viewMode !== "image" || !selectedResult) {
      return;
    }

    const files = selectedResult.payload?.files as Record<string, unknown> | undefined;
    const imagePaths = getImagePaths(files);
    
    if (imagePaths.length === 0) {
      return;
    }

    // Load each image
    const loadImages = async () => {
      const newLoadedImages: Record<string, string> = {};
      
      for (const img of imagePaths) {
        try {
          // Convert file path to URL that can be loaded in the browser
          const src = convertFileSrc(img.path);
          newLoadedImages[img.key] = src;
        } catch (err) {
          console.error(`Failed to load image ${img.key}:`, err);
        }
      }
      
      setLoadedImages(newLoadedImages);
    };

    loadImages();
  }, [viewMode, selectedResult]);

  // Get test types for filter dropdown
  const testTypes = Array.from(new Set(results.map((r) => r.payload?.test).filter(Boolean)));

  const formatDate = (timestamp: string | number | undefined) => {
    if (!timestamp) return "Unknown";
    if (typeof timestamp === "number") {
      return new Date(timestamp).toLocaleString();
    }
    return legacyTimestamp(timestamp);
  };

  // Get test type label - memoized with useCallback
  const getTestTypeLabel = useCallback((test: string): string => {
    return TEST_TYPE_LABELS[test] || test;
  }, []);

  // Format metrics summary - memoized with useCallback
  const getMetricsSummary = useCallback((entry: ResultEntry): string => {
    const metrics = entry.payload?.metrics as Record<string, unknown> | undefined;
    if (!metrics) return "";

    const testType = entry.payload?.test;
    
    if (testType === TEST_TYPES.LATENCY) {
      const avg = metrics.average_delay_ms;
      const std = metrics.std_dev_ms;
      if (avg !== undefined) {
        return `Avg: ${typeof avg === "number" ? avg.toFixed(2) : avg}ms${
          std !== undefined
            ? ` ±${typeof std === "number" ? std.toFixed(2) : std}ms`
            : ""
        }`;
      }
    }

    if (testType === TEST_TYPES.SWEEP_FR) {
      const left = metrics.delay_ms_left;
      const right = metrics.delay_ms_right;
      if (left !== undefined || right !== undefined) {
        return `L: ${left !== undefined ? (typeof left === "number" ? left.toFixed(1) : left) : "-"}ms | R: ${right !== undefined ? (typeof right === "number" ? right.toFixed(1) : right) : "-"}ms`;
      }
    }

    if (testType === TEST_TYPES.THD) {
      const thd = metrics.thd_percent;
      if (thd !== undefined) {
        return `THD: ${typeof thd === "number" ? thd.toFixed(3) : thd}%`;
      }
    }

    if (testType === TEST_TYPES.BALANCE) {
      const delta = metrics.l_minus_r_db;
      if (delta !== undefined) {
        return `L-R: ${typeof delta === "number" ? delta.toFixed(2) : delta} dB`;
      }
    }

    if (testType === TEST_TYPES.CROSSTALK) {
      const xt = metrics.crosstalk_db;
      if (xt !== undefined) {
        return `Crosstalk: ${typeof xt === "number" ? xt.toFixed(1) : xt} dB`;
      }
    }

    if (testType === TEST_TYPES.ISOLATION) {
      const delta = metrics.delta_db;
      if (delta !== undefined) {
        return `Isolation: ${typeof delta === "number" ? delta.toFixed(1) : delta} dB`;
      }
    }

    return JSON.stringify(metrics).slice(0, 50);
  }, []);

  // Check if result has image data (either from data array or from saved plot files)
  const hasImageData = useCallback((entry: ResultEntry): boolean => {
    // Check for plot files
    const files = entry.payload?.files as Record<string, unknown> | undefined;
    if (files && getImagePaths(files).length > 0) {
      return true;
    }
    
    // Check for raw data that could be plotted
    const data = entry.payload?.data as Record<string, unknown> | undefined;
    return Boolean(
      data &&
        ((Array.isArray(data.freqs) && data.freqs.length > 0) ||
          (Array.isArray(data.left_mag_db_avg) &&
            data.left_mag_db_avg.length > 0) ||
          (Array.isArray(data.right_mag_db_avg) &&
            data.right_mag_db_avg.length > 0))
    );
  }, []);

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
  const filteredResults =
    filterType === "all"
      ? totalResults
      : results.filter((r) => r.payload?.test === filterType).length;

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
            <span className="db-count">
              {filteredResults} of {totalResults} results
            </span>
            {results.length > 0 && (
              <span className="db-saved-badge" title="Results saved locally">
                ✓ Saved
              </span>
            )}
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
                      : "No results match the current filter."}
                  </div>
                ) : (
                  deviceGroups.map((group) => (
                    <div
                      key={group.deviceName}
                      className="db-item db-device-item"
                      onClick={() => setSelectedDevice(group.deviceName)}
                    >
                      <div className="db-item-header">
                        <span className="db-device-name">
                          {group.deviceName}
                        </span>
                        <span className="db-count-badge">
                          {group.results.length}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : !selectedTestTypeGroup ? (
              // Show test type groups (grouped by test type)
              <div className="db-list">
                <div className="db-breadcrumb">
                  <button
                    type="button"
                    className="db-back-btn"
                    onClick={() => {
                      setSelectedDevice(null);
                      setSelectedTestTypeGroup(null);
                      setSelectedResultId(null);
                    }}
                  >
                    ← Back to Devices
                  </button>
                  <span className="db-current-device">{selectedDevice}</span>
                </div>
                {testTypeGroups.map((group) => (
                  <div
                    key={group.testType}
                    className="db-item db-test-type-item"
                    onClick={() => setSelectedTestTypeGroup(group)}
                  >
                    <div className="db-item-header">
                      <span
                        className={`db-badge db-badge-${group.testType}`}
                      >
                        {getTestTypeLabel(group.testType)}
                      </span>
                      <span className="db-count-small">
                        {group.count} {group.count === 1 ? "test" : "tests"}
                      </span>
                    </div>
                    <div className="db-item-meta">
                      <span className="db-date">
                        Latest: {formatDate(group.latestTimestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Show individual results for a specific test type
              <div className="db-list">
                <div className="db-breadcrumb">
                  <button
                    type="button"
                    className="db-back-btn"
                    onClick={() => {
                      setSelectedTestTypeGroup(null);
                      setSelectedResultId(null);
                    }}
                  >
                    ← Back to {getTestTypeLabel(selectedTestTypeGroup.testType)}
                  </button>
                  <span className="db-current-device">
                    {selectedDevice} - {getTestTypeLabel(selectedTestTypeGroup.testType)}
                  </span>
                </div>
                {sortByDate(selectedTestTypeGroup.results).map((entry, idx) => (
                  <div
                    key={entry.id}
                    className={`db-item ${selectedResultId === entry.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedResultId(entry.id)}
                  >
                    <div className="db-item-header">
                      <span className="db-result-index">
                        #{selectedTestTypeGroup.results.length - idx}
                      </span>
                      <span className="db-date">
                        {formatDate(entry.savedAt || entry.payload?.timestamp)}
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
                    {getTestTypeLabel(selectedResult.payload?.test || "")} Result
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
                      <h4>Images</h4>
                      {(() => {
                        const files = selectedResult.payload?.files as Record<string, unknown> | undefined;
                        const imagePaths = getImagePaths(files);
                        
                        if (imagePaths.length === 0) {
                          return (
                            <div className="db-image-placeholder">
                              <p>No images available for this result.</p>
                            </div>
                          );
                        }
                        
                        return (
                          <div className="db-image-gallery">
                            {imagePaths.map((img) => (
                              <div key={img.key} className="db-image-item">
                                <div className="db-image-label">{img.label}</div>
                                {loadedImages[img.key] ? (
                                  <img 
                                    src={loadedImages[img.key]} 
                                    alt={img.label}
                                    className="db-image-img"
                                  />
                                ) : (
                                  <div className="db-image-loading">
                                    Loading...
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <>
                      <div className="db-detail-section">
                        <h4>Device</h4>
                        <p>{selectedResult.deviceName || UNKNOWN_DEVICE}</p>
                      </div>

                      <div className="db-detail-section">
                        <h4>Timestamp</h4>
                        <p>
                          {formatDate(
                            selectedResult.savedAt ||
                              selectedResult.payload?.timestamp,
                          )}
                        </p>
                      </div>

                      <div className="db-detail-section">
                        <h4>Parameters</h4>
                        <pre 
                          className="mono-pre"
                          dangerouslySetInnerHTML={{ __html: safeStringify(selectedResult.payload?.params, 500) }}
                        />
                      </div>

                      <div className="db-detail-section">
                        <h4>Metrics</h4>
                        <pre 
                          className="mono-pre"
                          dangerouslySetInnerHTML={{ __html: safeStringify(selectedResult.payload?.metrics, 500) }}
                        />
                      </div>

                      {selectedResult.payload?.data &&
                        Object.keys(selectedResult.payload.data).length > 0 && (
                          <div className="db-detail-section">
                            <h4>Data</h4>
                            <pre 
                              className="mono-pre"
                              dangerouslySetInnerHTML={{ __html: safeStringify(selectedResult.payload.data, 500) }}
                            />
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
                  : "Select a device from the list to view tests"}
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
        
        .db-count-small {
          font-size: 11px;
          color: var(--muted-color);
        }
        
        .db-test-type-item {
          background: var(--card-bg);
        }
        
        .db-test-type-item:hover {
          background: var(--hover-bg);
        }
        
        .db-item-meta {
          margin-top: 4px;
        }
        
        .db-result-index {
          font-size: 12px;
          font-weight: 600;
          color: var(--accent-color);
        }
        
        .db-saved-badge {
          font-size: 11px;
          color: #10b981;
          background: rgba(16, 185, 129, 0.1);
          padding: 2px 8px;
          border-radius: 4px;
        }
        
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
        
        .db-image-gallery {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .db-image-item {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
        }
        
        .db-image-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-color);
          margin-bottom: 8px;
        }
        
        .db-image-img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          display: block;
        }
        
        .db-image-loading {
          background: var(--code-bg);
          border-radius: 4px;
          padding: 32px;
          text-align: center;
          color: var(--muted-color);
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

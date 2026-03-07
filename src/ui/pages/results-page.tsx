import { ResultEntry } from "../model";

type ResultsPageProps = {
  resultText: string;
  logText: string;
  results: import("../model").ResultEntry[];
  onCopyLog: () => void;
  onClearLog: () => void;
  onClearResults: () => void;
  onDeleteResult: (id: number) => void;
  onRestoreResult: (entry: import("../model").ResultEntry) => void;
};

export function ResultsPage({
  resultText: _resultText,
  logText,
  results: _results,
  onCopyLog,
  onClearLog,
  onClearResults: _onClearResults,
  onDeleteResult: _onDeleteResult,
  onRestoreResult: _onRestoreResult,
}: ResultsPageProps) {
  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Results / Export</h2>

        {/* Log Tab - Only tab now */}
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
              Logs
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
      </section>
    </div>
  );
}


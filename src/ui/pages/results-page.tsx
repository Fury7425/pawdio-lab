type ResultsPageProps = {
  logText: string;
  onCopyLog: () => void;
  onClearLog: () => void;
};

export function ResultsPage({
  logText,
  onCopyLog,
  onClearLog,
}: ResultsPageProps) {
  return (
    <div className="page-stack">
      <section className="page-card">
        <div className="section-header-row">
          <h2 className="section-heading" style={{ marginBottom: 0 }}>
            Logs
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
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

        <div className="scroll-box">
          <pre className="mono-pre">
            {logText.length > 0 ? logText : "No logs yet."}
          </pre>
        </div>
      </section>
    </div>
  );
}

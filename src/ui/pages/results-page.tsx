type ResultsPageProps = {
  resultText: string;
  logText: string;
  onCopyLog: () => void;
  onClearLog: () => void;
  onClearResults: () => void;
};

export function ResultsPage({
  resultText,
  logText,
  onCopyLog,
  onClearLog,
  onClearResults
}: ResultsPageProps) {
  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Results / Export</h2>

        <section className="page-card">
          <h3 className="section-subheading">Results Output</h3>
          <div className="scroll-box">
            <pre className="mono-pre">{resultText.length > 0 ? resultText : "No test results yet."}</pre>
          </div>
        </section>

        <section className="page-card" style={{ marginTop: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap"
            }}
          >
            <h3 className="section-subheading" style={{ marginBottom: 0 }}>
              Results / Log
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="skin-btn secondary" onClick={onCopyLog}>
                Copy Log
              </button>
              <button type="button" className="skin-btn secondary" onClick={onClearLog}>
                Clear Log
              </button>
              <button type="button" className="skin-btn secondary" onClick={onClearResults}>
                Clear Results
              </button>
            </div>
          </div>

          <div className="scroll-box" style={{ marginTop: 10 }}>
            <pre className="mono-pre">{logText.length > 0 ? logText : "No logs yet."}</pre>
          </div>
        </section>
      </section>
    </div>
  );
}

import { usePawdioLabContext } from "../pawdio-context";

export function ResultsPage() {
  const ctx = usePawdioLabContext();
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
              onClick={() => ctx.run(ctx.copyLogs())}
            >
              Copy Log
            </button>
            <button
              type="button"
              className="skin-btn secondary"
              onClick={ctx.clearLogs}
            >
              Clear Log
            </button>
          </div>
        </div>

        <div className="scroll-box">
          <pre className="mono-pre">
            {ctx.logText.length > 0 ? ctx.logText : "No logs yet."}
          </pre>
        </div>
      </section>
    </div>
  );
}

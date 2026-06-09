import { PageHeader } from "../components/page-header";
import { usePawdioLabContext } from "../pawdio-context";

export function ResultsPage() {
  const ctx = usePawdioLabContext();
  return (
    <div className="page-stack">
      <section className="page-card">
        <PageHeader
          title="Logs"
          description="Raw output from every test run this session."
          actions={
            <>
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
            </>
          }
        />

        <div className="scroll-box">
          <pre className="mono-pre">
            {ctx.logText.length > 0 ? ctx.logText : "No logs yet."}
          </pre>
        </div>
      </section>
    </div>
  );
}

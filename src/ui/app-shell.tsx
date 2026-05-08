import { useEffect } from "react";
import { Sidebar } from "./components/sidebar";
import { ErrorBoundary } from "./components/error-boundary";
import { AncPage } from "./pages/anc-page";
import { DevicesPage } from "./pages/devices-page";
import { ExperimentalPage } from "./pages/experimental-page";
import { LatencyPage } from "./pages/latency-page";
import { ResultsPage } from "./pages/results-page";
import { SweepFrPage } from "./pages/sweep-fr-page";
import { startAppearanceThemeSync } from "./theme";
import { PageKeyEnum } from "./model";
import { PawdioLabProvider, usePawdioLabContext } from "./pawdio-context";

export function PawdioLabApp() {
  useEffect(() => startAppearanceThemeSync(), []);

  return (
    <ErrorBoundary fallbackTitle="App failed to start">
      <PawdioLabProvider>
        <PawdioLabShell />
      </PawdioLabProvider>
    </ErrorBoundary>
  );
}

function PawdioLabShell() {
  const ctx = usePawdioLabContext();

  return (
    <main className="app-canvas">
      <div className="app-layout">
        <Sidebar />

        <div className="main-column" key={ctx.activePage}>
          {ctx.error && (
            <section className="page-card">
              <h2 className="section-heading">Runtime Error</h2>
              <p className="muted">{ctx.error}</p>
            </section>
          )}

          <ErrorBoundary key={ctx.activePage}>
            {ctx.activePage === PageKeyEnum.Latency && <LatencyPage />}
            {ctx.activePage === PageKeyEnum.Anc && <AncPage />}
            {ctx.activePage === PageKeyEnum.SweepFr && <SweepFrPage />}
            {ctx.activePage === PageKeyEnum.Experimental && ctx.experimentalEnabled && (
              <ExperimentalPage />
            )}
            {ctx.activePage === PageKeyEnum.Devices && <DevicesPage />}
            {ctx.activePage === PageKeyEnum.Results && <ResultsPage />}
          </ErrorBoundary>
        </div>
      </div>
    </main>
  );
}

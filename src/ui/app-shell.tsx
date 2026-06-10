import { useEffect } from "react";
import { Sidebar } from "./components/sidebar";
import { ErrorBoundary } from "./components/error-boundary";
import { AncPage } from "./pages/anc-page";
import { DevicesPage } from "./pages/devices-page";
import { ExperimentalPage } from "./pages/experimental-page";
import { LatencyPage } from "./pages/latency-page";
import { LibraryPage } from "./pages/library-page";
import { ResultsPage } from "./pages/results-page";
import { SweepFrPage } from "./pages/sweep-fr-page";
import { startAppearanceThemeSync } from "./theme";
import { PageKeyEnum, pageItems } from "./model";
import { ToastProvider } from "./components/toast";
import { PawdioLabProvider, usePawdioLabContext } from "./pawdio-context";

export function PawdioLabApp() {
  useEffect(() => startAppearanceThemeSync(), []);

  return (
    <ErrorBoundary fallbackTitle="App failed to start">
      <ToastProvider>
        <PawdioLabProvider>
          <PawdioLabShell />
        </PawdioLabProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

function PawdioLabShell() {
  const ctx = usePawdioLabContext();

  // Ctrl+1..7 jumps between pages (power-user navigation).
  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }
      const digit = Number(event.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const visible = ctx.experimentalEnabled
        ? pageItems
        : pageItems.filter((item) => item.key !== "experimental");
      const item = visible[digit - 1];
      if (!item) return;
      event.preventDefault();
      ctx.setActivePage(item.key);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [ctx]);

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
            {ctx.activePage === PageKeyEnum.Experimental &&
              ctx.experimentalEnabled && <ExperimentalPage />}
            {ctx.activePage === PageKeyEnum.Devices && <DevicesPage />}
            {ctx.activePage === PageKeyEnum.Results && <ResultsPage />}
            {ctx.activePage === PageKeyEnum.Library && <LibraryPage />}
          </ErrorBoundary>
        </div>
      </div>
    </main>
  );
}

import { useCallback, useEffect } from "react";
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
import { PageKeyEnum } from "./model";
import type { PageKey } from "./model";
import {
  useShortcutBindings,
  useShortcutListener,
} from "./hooks/use-shortcuts";
import type { ShortcutAction } from "./lib/shortcuts";
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
  const { bindings } = useShortcutBindings();

  /** Which page each navigation shortcut goes to. */
  const NAVIGATION: Partial<Record<ShortcutAction, PageKey>> = {
    page_latency: PageKeyEnum.Latency,
    page_sweep_fr: PageKeyEnum.SweepFr,
    page_anc: PageKeyEnum.Anc,
    page_experimental: PageKeyEnum.Experimental,
    page_devices: PageKeyEnum.Devices,
    page_results: PageKeyEnum.Results,
    page_library: PageKeyEnum.Library,
  };

  const onShortcut = useCallback(
    (action: ShortcutAction) => {
      const page = NAVIGATION[action];
      if (page) {
        // The experimental page is only reachable when it is switched on.
        if (page === PageKeyEnum.Experimental && !ctx.experimentalEnabled) {
          return;
        }
        ctx.setActivePage(page);
        return;
      }

      switch (action) {
        case "start_test":
          // Only the pages with one obvious primary action respond, so the key
          // never starts something the user was not looking at.
          if (ctx.running) return;
          if (ctx.activePage === PageKeyEnum.Latency) {
            ctx.run(ctx.runLatencyTest());
          } else if (ctx.activePage === PageKeyEnum.SweepFr) {
            ctx.run(ctx.runSweepFrTest());
          }
          return;
        case "stop_test":
          if (ctx.running) ctx.run(ctx.stopTest());
          return;
        case "accept_review":
          if (ctx.sweepReviewState) ctx.acceptSweepReview();
          return;
        case "reject_review":
          if (ctx.sweepReviewState) ctx.rejectSweepReview();
          return;
        default:
          return;
      }
    },
    // NAVIGATION is a literal rebuilt each render; ctx carries everything else.
    [ctx], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useShortcutListener(bindings, onShortcut);

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

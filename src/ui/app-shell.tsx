import { Sidebar } from "./components/sidebar";
import { DevicesPage } from "./pages/devices-page";
import { ExperimentalPage } from "./pages/experimental-page";
import { LatencyPage } from "./pages/latency-page";
import { ResultsPage } from "./pages/results-page";
import { SweepFrPage } from "./pages/sweep-fr-page";
import { usePawdioLabController } from "./use-pawdio-lab";

export function PawdioLabApp() {
  const controller = usePawdioLabController();
  const run = (promise: Promise<unknown>) => {
    promise.catch((err) => console.error(err));
  };

  return (
    <main className="app-canvas">
      <div className="app-layout">
        <Sidebar
          activePage={controller.activePage}
          running={controller.running}
          onSelectPage={controller.setActivePage}
          onRefreshDevices={() => run(controller.loadState())}
          onStopTest={() => run(controller.stopTest())}
        />

        <div className="main-column">
          {controller.error && (
            <section className="page-card">
              <h2 className="section-heading">Runtime Error</h2>
              <p className="muted">{controller.error}</p>
            </section>
          )}

          {controller.activePage === "latency" && (
            <LatencyPage
              request={controller.latencyRequest}
              onChangeRequest={controller.setLatencyRequest}
              progressRows={controller.latencyProgress}
              report={controller.latencyReport}
              calibrationText={controller.calibrationText}
              running={controller.running}
              progressPercent={controller.latencyProgressPercent}
              onRunSelected={(keys) => run(controller.runLatencySelectedTests(keys))}
              onRunAll={() => run(controller.runLatencyAllTests())}
              onSaveReport={() => run(controller.exportLatencyReport())}
              onCalibrateSelected={(keys, repeats) =>
                run(controller.calibrateLatencySelected(keys, repeats))
              }
              onCalibrateAll={(repeats) => run(controller.calibrateLatencyAllPresets(repeats))}
              onCalibrateGlobal={(repeats) =>
                run(controller.calibrateLatencyGlobalImpulse(repeats))
              }
            />
          )}

          {controller.activePage === "sweep_fr" && (
            <SweepFrPage
              request={controller.sweepRequest}
              onChangeRequest={controller.setSweepRequest}
              running={controller.running}
              onRun={() => run(controller.runSweepFrTest())}
              lastResult={controller.sweepLastResult}
              monitor={controller.inputMonitor}
              pinkNoisePlaying={controller.pinkNoisePlaying}
              onStartMonitor={() => run(controller.startInputMonitor())}
              onStopMonitor={() => run(controller.stopInputMonitor())}
              onStartPinkNoise={() => run(controller.startPinkNoise())}
              onStopPinkNoise={() => run(controller.stopPinkNoise())}
              onResetPeak={() => run(controller.resetInputMonitorPeak())}
            />
          )}

          {controller.activePage === "experimental" && (
            <ExperimentalPage
              running={controller.running}
              balanceRequest={controller.balanceRequest}
              onChangeBalance={controller.setBalanceRequest}
              crosstalkRequest={controller.crosstalkRequest}
              onChangeCrosstalk={controller.setCrosstalkRequest}
              thdRequest={controller.thdRequest}
              thdToneText={controller.thdToneText}
              onChangeThdRequest={controller.setThdRequest}
              onChangeThdToneText={controller.setThdToneText}
              isolationRequest={controller.isolationRequest}
              onChangeIsolation={controller.setIsolationRequest}
              onRunBalance={() => run(controller.runBalanceTest())}
              onRunCrosstalk={() => run(controller.runCrosstalkTest())}
              onRunThd={() => run(controller.runThdTest())}
              onRunIsolation={() => run(controller.runIsolationTest())}
            />
          )}

          {controller.activePage === "devices" && (
            <DevicesPage
              inventory={controller.inventory}
              settings={controller.settings}
              onCommitSettings={(next) => run(controller.commitSettings(next))}
              onRefreshDevices={() => run(controller.loadState())}
            />
          )}

          {controller.activePage === "results" && (
            <ResultsPage
              resultText={controller.resultText}
              logText={controller.logText}
              onCopyLog={() => run(controller.copyLogs())}
              onClearLog={controller.clearLogs}
              onClearResults={controller.clearResults}
            />
          )}
        </div>
      </div>
    </main>
  );
}

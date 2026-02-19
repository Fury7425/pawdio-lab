import { Card, Text } from "@radix-ui/themes";
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
    <main className="subtle-grid min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
        <Sidebar
          activePage={controller.activePage}
          running={controller.running}
          onSelectPage={controller.setActivePage}
          onRefreshDevices={() => run(controller.loadState())}
          onStopTest={() => run(controller.stopTest())}
        />

        <div className="flex flex-col gap-4">
          {controller.error && (
            <Card className="glass-panel rounded-3xl">
              <Text color="red">{controller.error}</Text>
            </Card>
          )}

          {controller.activePage === "latency" && (
            <LatencyPage
              request={controller.latencyRequest}
              onChangeRequest={controller.setLatencyRequest}
              progressRows={controller.latencyProgress}
              report={controller.latencyReport}
              running={controller.running}
              progressPercent={controller.latencyProgressPercent}
              onRun={() => run(controller.runLatencyTest())}
            />
          )}

          {controller.activePage === "sweep_fr" && (
            <SweepFrPage
              request={controller.sweepRequest}
              onChangeRequest={controller.setSweepRequest}
              running={controller.running}
              onRun={() => run(controller.runSweepFrTest())}
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

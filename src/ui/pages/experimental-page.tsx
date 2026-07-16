import { ButtonHTMLAttributes } from "react";
import { FlaskConical } from "lucide-react";
import { toNumber, CrosstalkRequest } from "../model";
import { SelectField } from "../components/form-fields";
import { ExportMenu } from "../components/export-menu";
import { PageHeader } from "../components/page-header";
import {
  downloadCsv,
  downloadJson,
  exportTimestampTag,
  objectsToCsv,
} from "../lib/export-files";
import { usePawdioLabContext } from "../pawdio-context";

type RunButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

function RunButton(props: RunButtonProps) {
  return (
    <button type="button" className="skin-btn" {...props}>
      Run
    </button>
  );
}

export function ExperimentalPage() {
  const ctx = usePawdioLabContext();
  const running = ctx.running;
  const balanceRequest = ctx.balanceRequest;
  const onChangeBalance = ctx.setBalanceRequest;
  const crosstalkRequest = ctx.crosstalkRequest;
  const onChangeCrosstalk = ctx.setCrosstalkRequest;
  const thdRequest = ctx.thdRequest;
  const thdToneText = ctx.thdToneText;
  const onChangeThdRequest = ctx.setThdRequest;
  const onChangeThdToneText = ctx.setThdToneText;
  const isolationRequest = ctx.isolationRequest;
  const onChangeIsolation = ctx.setIsolationRequest;
  const onRunBalance = () => ctx.run(ctx.runBalanceTest());
  const onRunCrosstalk = () => ctx.run(ctx.runCrosstalkTest());
  const onRunThd = () => ctx.run(ctx.runThdTest());
  const onRunIsolation = () => ctx.run(ctx.runIsolationTest());
  const experimentalResults = ctx.results.filter((entry) =>
    ["balance", "crosstalk", "thd", "isolation"].includes(
      entry.payload.test,
    ),
  );

  function exportExperimentalJson() {
    downloadJson(`experimental_${exportTimestampTag()}.json`, {
      format: "pawdio-lab-experimental-export",
      version: 1,
      generatedAt: new Date().toISOString(),
      count: experimentalResults.length,
      results: experimentalResults,
    });
  }

  function exportExperimentalCsv() {
    const rows = experimentalResults.map((entry) => ({
      id: entry.id,
      deviceName: entry.deviceName ?? null,
      savedAt: entry.savedAt ?? null,
      ...entry.payload,
    }));
    downloadCsv(
      `experimental_${exportTimestampTag()}.csv`,
      objectsToCsv(rows),
    );
  }

  return (
    <div className="page-stack">
      <section className="page-card">
        <PageHeader
          title="Experimental Tests"
          description="Channel balance, crosstalk, THD, and isolation measurements."
          actions={
            <ExportMenu
              label={`Export Results (${experimentalResults.length})`}
              disabled={experimentalResults.length === 0}
              items={[
                {
                  label: "Export JSON",
                  onSelect: exportExperimentalJson,
                },
                {
                  label: "Export CSV",
                  onSelect: exportExperimentalCsv,
                },
              ]}
            />
          }
        />

        <div className="field-grid-2">
          <section className="page-card">
            <h3 className="section-subheading">Channel Balance</h3>
            <label className="field-row">
              <span className="field-label">Frequency (Hz)</span>
              <input
                className="skin-input"
                type="number"
                value={balanceRequest.frequencyHz}
                onChange={(event) =>
                  onChangeBalance({
                    ...balanceRequest,
                    frequencyHz: toNumber(event.target.value, 1000),
                  })
                }
              />
            </label>
            <div className="row-end mt-12">
              <RunButton disabled={running} onClick={onRunBalance} />
            </div>
          </section>

          <section className="page-card">
            <h3 className="section-subheading">Crosstalk</h3>
            <div className="field-grid-4">
              <label className="field-row field-span-3">
                <span className="field-label">Frequency (Hz)</span>
                <input
                  className="skin-input"
                  type="number"
                  value={crosstalkRequest.frequencyHz}
                  onChange={(event) =>
                    onChangeCrosstalk({
                      ...crosstalkRequest,
                      frequencyHz: toNumber(event.target.value, 1000),
                    })
                  }
                />
              </label>
              <SelectField
                label="Direction"
                value={crosstalkRequest.direction}
                onChange={(value) =>
                  onChangeCrosstalk({
                    ...crosstalkRequest,
                    direction: value as CrosstalkRequest["direction"],
                  })
                }
                options={[
                  { value: "LtoR", label: "LtoR" },
                  { value: "RtoL", label: "RtoL" },
                ]}
              />
            </div>
            <div className="row-end mt-12">
              <RunButton disabled={running} onClick={onRunCrosstalk} />
            </div>
          </section>

          <section className="page-card">
            <h3 className="section-subheading">THD</h3>
            <p className="muted">
              Runs 100 / 1k / 6k Hz distortion measurements.
            </p>
            <div className="field-grid-2 mt-10">
              <label className="field-row">
                <span className="field-label">Tones (Hz)</span>
                <input
                  className="skin-input"
                  value={thdToneText}
                  onChange={(event) => onChangeThdToneText(event.target.value)}
                  placeholder="100, 1000, 6000"
                />
              </label>
              <label className="field-row">
                <span className="field-label">Amplitude</span>
                <input
                  className="skin-input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={thdRequest.amplitude}
                  onChange={(event) =>
                    onChangeThdRequest({
                      ...thdRequest,
                      amplitude: toNumber(event.target.value, 0.6),
                    })
                  }
                />
              </label>
            </div>
            <div className="row-end mt-12">
              <RunButton disabled={running} onClick={onRunThd} />
            </div>
          </section>

          <section className="page-card">
            <h3 className="section-subheading">Isolation</h3>
            <p className="muted">Measures inside to outside isolation.</p>
            <div className="field-grid-2 mt-10">
              <label className="field-row">
                <span className="field-label">Noise Duration (s)</span>
                <input
                  className="skin-input"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={isolationRequest.noiseDurationSecs}
                  onChange={(event) =>
                    onChangeIsolation({
                      ...isolationRequest,
                      noiseDurationSecs: toNumber(event.target.value, 2),
                    })
                  }
                />
              </label>
              <label className="field-row">
                <span className="field-label">Amplitude</span>
                <input
                  className="skin-input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isolationRequest.amplitude}
                  onChange={(event) =>
                    onChangeIsolation({
                      ...isolationRequest,
                      amplitude: toNumber(event.target.value, 0.4),
                    })
                  }
                />
              </label>
            </div>
            <div className="row-end mt-12">
              <RunButton disabled={running} onClick={onRunIsolation} />
            </div>
          </section>
        </div>

        <hr className="section-divider" />
        <section className="page-section">
          <h3 className="section-subheading">Experimental Results</h3>
          {experimentalResults.length === 0 ? (
            <div className="placeholder-box" style={{ minHeight: 220 }}>
              <div className="empty-state">
                <FlaskConical size={28} />
                <span>Run an experimental test to see results</span>
                <span className="muted">
                  Results appear here, in Logs, and can be saved from Library.
                </span>
              </div>
            </div>
          ) : (
            <div className="scroll-box" style={{ maxHeight: 320 }}>
              {experimentalResults
                .slice()
                .reverse()
                .map((entry) => (
                  <article key={entry.id} className="page-section">
                    <div className="result-header">
                      <h4>{entry.payload.test.replace(/_/g, " ")}</h4>
                      <time>{entry.payload.timestamp}</time>
                    </div>
                    <div className="metric-grid mt-8">
                      {Object.entries(entry.payload.metrics).map(
                        ([key, value]) => (
                          <article key={key} className="metric-card">
                            <p className="metric-label">{key}</p>
                            <p className="metric-value">
                              {typeof value === "number"
                                ? value.toFixed(3)
                                : String(value)}
                            </p>
                          </article>
                        ),
                      )}
                    </div>
                  </article>
                ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

import { ButtonHTMLAttributes } from "react";
import {
  BalanceRequest,
  CrosstalkRequest,
  IsolationRequest,
  ThdRequest,
  toNumber,
} from "../model";

type ExperimentalPageProps = {
  running: boolean;
  balanceRequest: BalanceRequest;
  onChangeBalance: (request: BalanceRequest) => void;
  crosstalkRequest: CrosstalkRequest;
  onChangeCrosstalk: (request: CrosstalkRequest) => void;
  thdRequest: ThdRequest;
  thdToneText: string;
  onChangeThdRequest: (request: ThdRequest) => void;
  onChangeThdToneText: (value: string) => void;
  isolationRequest: IsolationRequest;
  onChangeIsolation: (request: IsolationRequest) => void;
  onRunBalance: () => void;
  onRunCrosstalk: () => void;
  onRunThd: () => void;
  onRunIsolation: () => void;
};

type RunButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

function RunButton(props: RunButtonProps) {
  return (
    <button type="button" className="skin-btn" {...props}>
      Run
    </button>
  );
}

export function ExperimentalPage({
  running,
  balanceRequest,
  onChangeBalance,
  crosstalkRequest,
  onChangeCrosstalk,
  thdRequest,
  thdToneText,
  onChangeThdRequest,
  onChangeThdToneText,
  isolationRequest,
  onChangeIsolation,
  onRunBalance,
  onRunCrosstalk,
  onRunThd,
  onRunIsolation,
}: ExperimentalPageProps) {
  return (
    <div className="page-stack">
      <section className="page-card">
        <h2 className="section-heading">Experimental Tests</h2>

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
              <label className="field-row" style={{ gridColumn: "span 3" }}>
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
              <label className="field-row">
                <span className="field-label">Direction</span>
                <select
                  className="skin-select"
                  value={crosstalkRequest.direction}
                  onChange={(event) =>
                    onChangeCrosstalk({
                      ...crosstalkRequest,
                      direction: event.target
                        .value as CrosstalkRequest["direction"],
                    })
                  }
                >
                  <option value="LtoR">LtoR</option>
                  <option value="RtoL">RtoL</option>
                </select>
              </label>
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
            <p className="muted">
              Measures inside to outside isolation.
            </p>
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
          <div className="placeholder-box" style={{ minHeight: 220 }} />
          <div className="row-end mt-12">
            <button type="button" className="skin-btn secondary" disabled>
              Export LAST (JSON)
            </button>
            <button type="button" className="skin-btn secondary" disabled>
              Export ALL (JSON)
            </button>
          </div>
        </section>
      </section>
    </div>
  );
}

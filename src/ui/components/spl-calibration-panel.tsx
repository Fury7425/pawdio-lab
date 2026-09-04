/**
 * One-point SPL calibration.
 *
 * A measured sweep tells you the shape of a response but not its level. One
 * known reference fixes that: put the microphone in an acoustic calibrator,
 * read the level the app sees, and the relationship between full scale and
 * pascals follows. From then on the input meter reads in dB SPL and level
 * figures mean something outside this app.
 */
import { useState } from "react";
import { Gauge } from "lucide-react";
import { usePawdioLabContext } from "../pawdio-context";
import { useActiveInputCalibration } from "../hooks/use-spl-calibration";
import {
  COMMON_CALIBRATOR_DB_SPL,
  dbfsToDbSpl,
  sensitivityDbFsPerPa,
  sensitivityFromDbfs,
} from "../lib/spl-calibration";

export function SplCalibrationPanel() {
  const ctx = usePawdioLabContext();
  const monitor = ctx.inputMonitor;

  const { deviceName, sensitivity, save, clear, calibrated } =
    useActiveInputCalibration();
  const [calibratorDbSpl, setCalibratorDbSpl] = useState<number>(
    COMMON_CALIBRATOR_DB_SPL[0],
  );

  const monitorRunning = monitor.monitoring;
  const liveDbSpl =
    sensitivity !== null ? dbfsToDbSpl(monitor.currentDbfs, sensitivity) : null;
  const datasheet =
    sensitivity !== null ? sensitivityDbFsPerPa(sensitivity) : null;

  function captureReference() {
    const value = sensitivityFromDbfs(monitor.currentDbfs, calibratorDbSpl);
    if (value === null) return;
    save(value);
  }

  return (
    <section className="page-section">
      <h3 className="section-subheading">
        <Gauge size={15} /> SPL Calibration
      </h3>
      <p className="muted mb-12">
        Calibration is stored per input device. Current device:{" "}
        <strong>{deviceName}</strong>.
      </p>

      <div className="field-grid-2">
        <label className="field-row">
          <span className="field-label">Calibrator level (dB SPL)</span>
          <input
            className="skin-input"
            type="number"
            min={60}
            max={140}
            step={0.1}
            value={calibratorDbSpl}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              setCalibratorDbSpl(Number.isFinite(parsed) ? parsed : 94);
            }}
          />
        </label>

        <div className="field-row">
          <span className="field-label">Live input</span>
          <p className="metric-value">
            {monitorRunning
              ? liveDbSpl !== null
                ? `${liveDbSpl.toFixed(1)} dB SPL`
                : `${monitor.currentDbfs.toFixed(1)} dBFS`
              : "Monitor stopped"}
          </p>
        </div>
      </div>

      <p className="muted compact-note mt-10">
        Fit the microphone into the calibrator, start the input monitor, wait
        for the reading to settle, then capture. Everything after that is
        arithmetic on that one point.
      </p>

      <div className="chip-row mt-12">
        <button
          type="button"
          className="skin-btn secondary"
          onClick={() =>
            ctx.run(
              monitorRunning ? ctx.stopInputMonitor() : ctx.startInputMonitor(),
            )
          }
        >
          {monitorRunning ? "Stop monitor" : "Start monitor"}
        </button>
        <button
          type="button"
          className="skin-btn"
          disabled={!monitorRunning}
          onClick={captureReference}
        >
          Capture reference
        </button>
        {calibrated && (
          <button type="button" className="skin-btn secondary" onClick={clear}>
            Clear
          </button>
        )}
      </div>

      {calibrated && sensitivity !== null && (
        <dl className="diagnostic-grid">
          <div className="diagnostic-cell">
            <dt>Sensitivity</dt>
            <dd>{sensitivity.toFixed(4)} Pa/FS</dd>
          </div>
          {datasheet !== null && (
            <div className="diagnostic-cell">
              <dt>Full scale</dt>
              <dd>{(-datasheet).toFixed(1)} dB re 1 Pa</dd>
            </div>
          )}
          <div className="diagnostic-cell">
            <dt>Clipping at</dt>
            <dd>{(20 * Math.log10(sensitivity / 20e-6)).toFixed(1)} dB SPL</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

/**
 * The row of controls that decides how a measured curve is drawn: smoothing,
 * normalisation, compensation target, and preference bounds. Compensation and
 * bounds curves are plain text files the user loads, so nothing here assumes a
 * particular rig or target.
 */
import { useRef } from "react";
import { Upload, X } from "lucide-react";
import {
  SMOOTHING_FRACTIONS,
  type CurveViewController,
} from "../hooks/use-curve-view";

type Props = {
  controller: CurveViewController;
  /** Hide the bounds controls where they would not fit. */
  showBoundsControls?: boolean;
};

export function CurveViewControls({
  controller,
  showBoundsControls = true,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { view, update, library, removeCurve, importFiles, loadError } =
    controller;
  const hasPopulation = Boolean(controller.compensation?.percentiles);

  return (
    <div className="curve-view-controls">
      <div className="chip-row">
        <span className="field-label">Smoothing</span>
        <button
          type="button"
          className={`chip-btn${view.smoothing === null ? " is-on" : ""}`}
          aria-pressed={view.smoothing === null}
          onClick={() => update({ smoothing: null })}
        >
          Raw
        </button>
        {SMOOTHING_FRACTIONS.map((fraction) => (
          <button
            key={fraction}
            type="button"
            className={`chip-btn${view.smoothing === fraction ? " is-on" : ""}`}
            aria-pressed={view.smoothing === fraction}
            onClick={() => update({ smoothing: fraction })}
          >
            1/{fraction}
          </button>
        ))}
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={`chip-btn${view.normalize ? " is-on" : ""}`}
          aria-pressed={view.normalize}
          onClick={() => update({ normalize: !view.normalize })}
        >
          Normalise
        </button>
        <label className="field-row inline-field">
          <span className="field-label">at</span>
          <input
            className="skin-input compact"
            type="number"
            min={20}
            max={20000}
            step={10}
            value={view.normalizeHz}
            disabled={!view.normalize}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              update({
                normalizeHz: Number.isFinite(parsed)
                  ? Math.min(20000, Math.max(20, parsed))
                  : 1000,
              });
            }}
          />
          <span className="field-label">Hz</span>
        </label>
      </div>

      <div className="chip-row">
        <label className="field-row inline-field">
          <span className="field-label">Compensation</span>
          <select
            className="skin-select compact"
            value={view.compensationId ?? "none"}
            onChange={(event) =>
              update({
                compensationId:
                  event.target.value === "none" ? null : event.target.value,
              })
            }
          >
            <option value="none">None (raw)</option>
            {library.map((curve) => (
              <option key={curve.id} value={curve.id}>
                {curve.name}
                {curve.percentiles ? " (population)" : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="chip-btn"
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={13} /> Load file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.csv,text/plain"
          multiple
          hidden
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void importFiles(files);
            event.target.value = "";
          }}
        />

        {view.compensationId && (
          <button
            type="button"
            className="chip-btn"
            title="Remove this curve from the library"
            onClick={() => removeCurve(view.compensationId as string)}
          >
            <X size={13} /> Remove
          </button>
        )}

        {hasPopulation && (
          <button
            type="button"
            className={`chip-btn${view.showPopulationBand ? " is-on" : ""}`}
            aria-pressed={view.showPopulationBand}
            onClick={() =>
              update({ showPopulationBand: !view.showPopulationBand })
            }
          >
            Population band
          </button>
        )}
      </div>

      {showBoundsControls && (
        <div className="chip-row">
          <button
            type="button"
            className={`chip-btn${view.showBounds ? " is-on" : ""}`}
            aria-pressed={view.showBounds}
            onClick={() => update({ showBounds: !view.showBounds })}
          >
            Bounds
          </button>
          <label className="field-row inline-field">
            <span className="field-label">Upper</span>
            <select
              className="skin-select compact"
              value={view.boundsUpperId ?? "none"}
              disabled={!view.showBounds}
              onChange={(event) =>
                update({
                  boundsUpperId:
                    event.target.value === "none" ? null : event.target.value,
                })
              }
            >
              <option value="none">None</option>
              {library.map((curve) => (
                <option key={curve.id} value={curve.id}>
                  {curve.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row inline-field">
            <span className="field-label">Lower</span>
            <select
              className="skin-select compact"
              value={view.boundsLowerId ?? "none"}
              disabled={!view.showBounds}
              onChange={(event) =>
                update({
                  boundsLowerId:
                    event.target.value === "none" ? null : event.target.value,
                })
              }
            >
              <option value="none">None</option>
              {library.map((curve) => (
                <option key={curve.id} value={curve.id}>
                  {curve.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {library.length === 0 && (
        <p className="muted compact-note">
          Load a two-column <code>frequency value</code> text file to compensate
          the curve, or a six-column population file to also draw its spread.
        </p>
      )}
      {loadError && <p className="field-error">{loadError}</p>}
    </div>
  );
}

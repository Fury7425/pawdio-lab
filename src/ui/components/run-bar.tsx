import type { ReactNode } from "react";
import { Square } from "lucide-react";
import { usePawdioLabContext } from "../pawdio-context";
import { useShortcutBindings } from "../hooks/use-shortcuts";

type RunBarProps = {
  /** The page's run buttons, left of the status. */
  actions?: ReactNode;
  /** One line describing what is running or what will run. */
  status: ReactNode;
  /** Right-aligned detail on the status line (counts, percent). */
  detail?: ReactNode;
  /** 0 to 100; omit to hide the track. */
  progress?: number | null;
  /** Whether Stop shows; defaults to the global running flag. */
  stoppable?: boolean;
};

/**
 * Bottom bar pinned to the page: run, progress and stop in one place on every
 * test page. Stop shows only while something runs.
 */
export function RunBar({
  actions,
  status,
  detail,
  progress,
  stoppable,
}: RunBarProps) {
  const ctx = usePawdioLabContext();
  const { bindings } = useShortcutBindings();
  const stopKey = bindings.stop_test;
  const showStop = stoppable ?? ctx.running;

  return (
    <div className={`run-bar${showStop ? " is-running" : ""}`}>
      {actions && <div className="run-bar-actions">{actions}</div>}
      <div className="run-bar-status" role="status" aria-live="polite">
        <div className="run-bar-line">
          <span className="run-bar-text">{status}</span>
          {detail && <span className="run-bar-detail">{detail}</span>}
        </div>
        {progress != null && (
          <div className="run-bar-track" aria-hidden="true">
            <div
              className="run-bar-fill"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
      </div>
      {showStop && (
        <button
          type="button"
          className="skin-btn danger run-bar-stop"
          onClick={() => ctx.run(ctx.stopTest())}
        >
          <Square size={12} fill="currentColor" aria-hidden="true" />
          Stop
          {stopKey && <kbd className="btn-kbd">{stopKey}</kbd>}
        </button>
      )}
    </div>
  );
}

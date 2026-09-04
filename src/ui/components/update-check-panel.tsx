/**
 * Manual release check.
 *
 * Nothing is contacted until the button is pressed, and the only outcome is a
 * version number and a link. The app never downloads or installs anything on
 * the user's behalf.
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import * as ipc from "../../ipc/commands";
import {
  checkForUpdate,
  RELEASES_PAGE_URL,
  type UpdateCheckState,
} from "../lib/update-check";

const CURRENT_VERSION = __APP_VERSION__;

export function UpdateCheckPanel() {
  const [state, setState] = useState<UpdateCheckState>({ status: "idle" });

  async function runCheck() {
    setState({ status: "checking" });
    setState(await checkForUpdate(CURRENT_VERSION));
  }

  const releaseUrl =
    state.status === "available" ? state.info.releaseUrl : RELEASES_PAGE_URL;

  return (
    <section className="page-section">
      <h3 className="section-subheading">
        <RefreshCw size={15} /> Updates
      </h3>
      <p className="muted mb-12">
        Installed version <strong>{CURRENT_VERSION}</strong>. Checking contacts
        the project's GitHub releases page and nothing else.
      </p>

      <div className="chip-row">
        <button
          type="button"
          className="skin-btn"
          disabled={state.status === "checking"}
          onClick={() => void runCheck()}
        >
          {state.status === "checking" ? "Checking…" : "Check for updates"}
        </button>

        {state.status === "available" && (
          <button
            type="button"
            className="skin-btn secondary"
            onClick={() => void ipc.openExternalUrl(releaseUrl).catch(() => {})}
          >
            Open release page
          </button>
        )}
      </div>

      {state.status === "current" && (
        <p className="muted mt-10">
          Up to date. Latest release is {state.latestVersion}.
        </p>
      )}
      {state.status === "available" && (
        <p className="mt-10">
          Version {state.info.latestVersion} is available.
          {state.info.summary ? ` ${state.info.summary}` : ""}
        </p>
      )}
      {state.status === "failed" && (
        <p className="field-error mt-10">{state.message}</p>
      )}
    </section>
  );
}

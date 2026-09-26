import { createContext, useContext, type ReactNode } from "react";
import {
  usePawdioLabController,
  type PawdioLabController,
} from "./use-pawdio-lab";

/**
 * Wraps the monolithic `usePawdioLabController()` hook in a React context.
 *
 * Pages consume the controller via `usePawdioLabContext()` instead of receiving
 * 14-21 props from the shell. The `run` helper centralises promise error handling
 * (was previously duplicated as `run(...)` in app-shell.tsx).
 *
 * The single hook is still mounted exactly once (in `PawdioLabProvider`) — no
 * change in render or state-management semantics, only in distribution.
 */

export type PawdioLabContextValue = PawdioLabController & {
  /** Run a promise with centralised error reporting via `setError`. */
  run: (promise: Promise<unknown>) => void;
};

const PawdioLabContext = createContext<PawdioLabContextValue | null>(null);

export function PawdioLabProvider({ children }: { children: ReactNode }) {
  const controller = usePawdioLabController();

  // The controller is a fresh object every render, so the context value is
  // too; memoising it here would never hit.
  const value: PawdioLabContextValue = {
    ...controller,
    run: (promise: Promise<unknown>) => {
      promise.catch((err) => controller.setError(String(err)));
    },
  };

  return (
    <PawdioLabContext.Provider value={value}>
      {children}
    </PawdioLabContext.Provider>
  );
}

export function usePawdioLabContext(): PawdioLabContextValue {
  const ctx = useContext(PawdioLabContext);
  if (!ctx) {
    throw new Error(
      "usePawdioLabContext must be used inside <PawdioLabProvider>",
    );
  }
  return ctx;
}

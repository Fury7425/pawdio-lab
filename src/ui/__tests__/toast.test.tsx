import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "../components/toast";

function Trigger({ message, kind }: { message: string; kind?: "error" }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message, { kind })}>
      fire
    </button>
  );
}

// Dismissing is two-phase: the toast is marked `leaving` so the exit
// transition can play, then unmounts EXIT_MS later. Tests must run past both.
const EXIT_MS = 120;

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast and auto-dismisses it", () => {
    render(
      <ToastProvider>
        <Trigger message="Saved!" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("Saved!")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4100 + EXIT_MS);
    });
    expect(screen.queryByText("Saved!")).not.toBeInTheDocument();
  });

  it("keeps error toasts longer and marks them as alerts", () => {
    render(
      <ToastProvider>
        <Trigger message="Boom" kind="error" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByText("Boom")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000 + EXIT_MS);
    });
    expect(screen.queryByText("Boom")).not.toBeInTheDocument();
  });

  it("dismisses on the close button", () => {
    render(
      <ToastProvider>
        <Trigger message="Bye" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("fire"));
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    act(() => {
      vi.advanceTimersByTime(EXIT_MS);
    });
    expect(screen.queryByText("Bye")).not.toBeInTheDocument();
  });

  it("still unmounts when the close button is clicked repeatedly", () => {
    render(
      <ToastProvider>
        <Trigger message="Spam" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("fire"));
    const close = screen.getByLabelText("Dismiss notification");
    // Each extra click used to cancel the pending unmount and reschedule it a
    // full EXIT_MS out, so a toast could be held on screen indefinitely. The
    // clock below only ever passes EXIT_MS measured from the *first* click, so
    // any rescheduling leaves the toast on screen and fails here.
    fireEvent.click(close);
    act(() => {
      vi.advanceTimersByTime(EXIT_MS / 2);
    });
    fireEvent.click(close);
    fireEvent.click(close);
    act(() => {
      vi.advanceTimersByTime(EXIT_MS / 2 + 5);
    });
    expect(screen.queryByText("Spam")).not.toBeInTheDocument();
  });
});

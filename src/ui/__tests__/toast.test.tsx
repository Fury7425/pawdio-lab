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
      vi.advanceTimersByTime(4100);
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
      vi.advanceTimersByTime(4000);
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
    expect(screen.queryByText("Bye")).not.toBeInTheDocument();
  });
});

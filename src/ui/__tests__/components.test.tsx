import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChipGroup } from "../components/chip-group";
import { EmptyState } from "../components/empty-state";
import { ExportMenu } from "../components/export-menu";
import {
  CheckboxField,
  RangeField,
  SelectField,
} from "../components/form-fields";
import { MetricCard } from "../components/metric-card";
import { Modal } from "../components/modal";

describe("ChipGroup", () => {
  const options = [
    { key: "a", label: "Alpha" },
    { key: "b", label: "Beta" },
  ] as const;

  it("renders chips with pressed state and toggles", () => {
    const onToggle = vi.fn();
    render(
      <ChipGroup
        options={options}
        selected={{ a: true, b: false }}
        onToggle={onToggle}
        ariaLabel="Test chips"
      />,
    );

    const alpha = screen.getByRole("button", { name: "Alpha" });
    expect(alpha).toHaveAttribute("aria-pressed", "true");
    expect(alpha.className).toContain("is-on");

    const beta = screen.getByRole("button", { name: "Beta" });
    expect(beta).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(beta);
    expect(onToggle).toHaveBeenCalledWith("b");
  });
});

describe("Modal", () => {
  it("renders title, children, and footer when open", () => {
    render(
      <Modal open onClose={() => {}} title="Hello" footer={<button>OK</button>}>
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape and focuses the first focusable element", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <input aria-label="Name" />
      </Modal>,
    );

    expect(screen.getByLabelText("Name")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ExportMenu", () => {
  it("opens the menu and fires the item callback", () => {
    const onSelect = vi.fn();
    render(<ExportMenu items={[{ label: "Export CSV", onSelect }]} />);

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    const item = screen.getByRole("menuitem", { name: "Export CSV" });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("MetricCard", () => {
  it("renders label, value, and tier class", () => {
    render(<MetricCard label="Average (ms)" value="12.3" tier="good" />);
    expect(screen.getByText("Average (ms)")).toBeInTheDocument();
    const card = screen.getByText("12.3").closest("article");
    expect(card?.className).toContain("metric-good");
  });

  it("omits tier class when tier is null", () => {
    render(<MetricCard label="Std Dev" value="—" tier={null} />);
    const card = screen.getByText("Std Dev").closest("article");
    expect(card?.className.trim()).toBe("metric-card");
  });
});

describe("EmptyState", () => {
  it("renders message and optional hint", () => {
    render(<EmptyState message="Nothing yet" hint="Run a test first" />);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByText("Run a test first")).toBeInTheDocument();
  });
});

describe("form fields", () => {
  it("SelectField emits the chosen value", () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Mode"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("RangeField emits a number and shows the value", () => {
    const onChange = vi.fn();
    render(
      <RangeField
        label="Repeats"
        min={1}
        max={20}
        value={5}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Repeats"), {
      target: { value: "7" },
    });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("CheckboxField emits the checked state", () => {
    const onChange = vi.fn();
    render(
      <CheckboxField label="Save plots" checked={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("Save plots"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { OverlayChart, type OverlaySeries } from "../components/overlay-chart";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OverlayChart", () => {
  it("omits hidden series from hover info and preserves hover opacity", () => {
    const onHover = vi.fn();
    const series: OverlaySeries[] = [
      {
        id: "hidden",
        label: "Hidden",
        color: "var(--accent-strong)",
        opacity: 0.25,
        showInHover: false,
        freqs: [100, 1000],
        values: [0, 0],
      },
      {
        id: "visible",
        label: "Visible",
        color: "hsl(175, 65%, 45%)",
        opacity: 0.4,
        freqs: [100, 1000],
        values: [1, 1],
      },
    ];

    const rect = {
      left: 0,
      top: 0,
      width: 220,
      height: 110,
      right: 220,
      bottom: 110,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(rect);

    const { container } = render(
      <OverlayChart
        series={series}
        yMin={-5}
        yMax={5}
        ariaLabel="Hover chart"
        onHover={onHover}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    fireEvent.mouseMove(svg as SVGElement, {
      clientX: 120,
      clientY: 40,
    });

    const lastCall = onHover.mock.calls.at(-1)?.[0];
    expect(lastCall?.items.map((item) => item.id)).toEqual(["visible"]);
    expect(lastCall?.items[0]?.opacity).toBe(0.4);
  });
});

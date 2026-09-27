export type ChartLegendItem = {
  id: string;
  label: string;
  color: string;
  /** Matches the series' SVG dash pattern; rendered as a dashed swatch. */
  dash?: string;
};

type ChartLegendProps = {
  items: ChartLegendItem[];
  /** With `onToggle`, entries become buttons that hide and show a series. */
  hiddenIds?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
};

export function ChartLegend({ items, hiddenIds, onToggle }: ChartLegendProps) {
  if (items.length === 0) return null;
  return (
    <div className="chart-legend">
      {items.map((item) => {
        const swatch = (
          <span
            className="chart-swatch"
            aria-hidden="true"
            style={
              item.dash
                ? {
                    background: `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`,
                  }
                : { background: item.color }
            }
          />
        );
        if (!onToggle) {
          return (
            <span key={item.id} className="chart-legend-item">
              {swatch}
              {item.label}
            </span>
          );
        }
        const off = hiddenIds?.has(item.id) ?? false;
        return (
          <button
            key={item.id}
            type="button"
            className={`chart-legend-item chart-legend-toggle${off ? " is-off" : ""}`}
            aria-pressed={!off}
            title={off ? "Show this curve" : "Hide this curve"}
            onClick={() => onToggle(item.id)}
          >
            {swatch}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

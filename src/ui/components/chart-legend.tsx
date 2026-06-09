export type ChartLegendItem = {
  id: string;
  label: string;
  color: string;
  /** Matches the series' SVG dash pattern; rendered as a dashed swatch. */
  dash?: string;
};

export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span key={item.id} className="chart-legend-item">
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
          {item.label}
        </span>
      ))}
    </div>
  );
}

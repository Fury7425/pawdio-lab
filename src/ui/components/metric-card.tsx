export type MetricTier = "good" | "warn" | "bad";

type MetricCardProps = {
  label: string;
  value: string;
  tier?: MetricTier | null;
  title?: string;
};

export function MetricCard({ label, value, tier, title }: MetricCardProps) {
  return (
    <article
      className={`metric-card ${tier ? `metric-${tier}` : ""}`.trim()}
      title={title}
    >
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  );
}

import type { CSSProperties, ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  message: string;
  hint?: string;
  style?: CSSProperties;
};

export function EmptyState({ icon, message, hint, style }: EmptyStateProps) {
  return (
    <div className="empty-state" style={style}>
      {icon}
      <span>{message}</span>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

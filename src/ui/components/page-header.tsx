import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Right-aligned slot for page-level actions (e.g. an ExportMenu). */
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h2 className="section-heading">{title}</h2>
        {description && <p className="muted page-header-desc">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

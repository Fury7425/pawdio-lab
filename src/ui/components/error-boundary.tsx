import { Component, ErrorInfo, ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[pawdio-lab] ErrorBoundary caught:", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  copy = async (): Promise<void> => {
    const text = `${this.state.error?.name}: ${this.state.error?.message}\n\n${this.state.error?.stack ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn("[pawdio-lab] clipboard write failed:", err);
    }
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <section className="page-card">
        <h2 className="section-heading">{this.props.fallbackTitle ?? "Something went wrong"}</h2>
        <p className="muted">{this.state.error.message}</p>
        <pre
          style={{
            maxHeight: "200px",
            overflow: "auto",
            fontSize: "11px",
            background: "var(--surface-2, #1a1a1a)",
            padding: "8px",
            borderRadius: "4px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {this.state.error.stack ?? this.state.error.toString()}
        </pre>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button type="button" className="skin-btn" onClick={this.reset}>
            Try again
          </button>
          <button type="button" className="skin-btn secondary" onClick={this.copy}>
            Copy error
          </button>
          <button type="button" className="skin-btn secondary" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </section>
    );
  }
}

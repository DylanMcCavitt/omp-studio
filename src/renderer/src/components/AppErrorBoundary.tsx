// App-level render error boundary (G2). Wraps the chat surface in Layout so one
// component throwing during render shows an actionable fallback (message + Reset
// view + Copy-error) instead of a blank white window — the cockpit is
// long-running, so a single crashed view must not take down the shell.
//
// By design this catches ONLY render/lifecycle errors (that is all React error
// boundaries can catch). Event-handler and async errors are NOT swallowed; they
// propagate to the host as usual.

import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui";

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Optional hook invoked by "Reset view" after the boundary clears its error. */
  onReset?: () => void;
  /**
   * When this value changes a caught error is cleared. App passes the active
   * session id so opening another chat recovers automatically instead of
   * stranding the fallback over the next session's transcript.
   */
  resetKey?: unknown;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
    copied: false,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AppErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(_error: Error, info: ErrorInfo): void {
    // Keep the component stack for the Copy-error payload.
    this.setState({ componentStack: info.componentStack ?? null });
  }

  override componentDidUpdate(prev: AppErrorBoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, componentStack: null, copied: false });
    }
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null, componentStack: null, copied: false });
    this.props.onReset?.();
  };

  private readonly handleCopy = (): void => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const payload = [
      error.message,
      error.stack ?? "",
      componentStack ? `\nComponent stack:${componentStack}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard?.writeText(payload).then(
      () => this.setState({ copied: true }),
      () => {
        /* clipboard denied — leave the label unchanged */
      },
    );
  };

  override render(): ReactNode {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h2 className="text-base font-semibold text-ink">
            Something went wrong
          </h2>
          <p className="text-sm text-ink-muted">
            This view hit an unexpected error and stopped rendering. The rest of
            the app is still running — reset the view to continue.
          </p>
          <p className="break-words font-mono text-xs text-danger">
            {error.message}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={this.handleReset}>
            Reset view
          </Button>
          <Button variant="subtle" onClick={this.handleCopy}>
            {copied ? "Copied" : "Copy error"}
          </Button>
        </div>
      </div>
    );
  }
}

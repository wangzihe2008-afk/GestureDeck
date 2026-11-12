import { Component, type ErrorInfo, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GestureDeck recovered from a page error.', error, info.componentStack);
    try {
      sessionStorage.setItem(
        'gesturedeck.lastError',
        JSON.stringify({
          message: error.message,
          stack: info.componentStack,
          time: new Date().toISOString(),
        }),
      );
    } catch {
      /* diagnostics are optional */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="recovery-screen" role="alert">
        <img src="/logo.svg" alt="" />
        <span className="eyebrow">GESTUREDECK / RECOVERY</span>
        <h1>The page hit an unexpected error.</h1>
        <p>
          Your saved poses are still stored in this browser. A temporary camera or drawing error can
          be retried safely.
        </p>
        {this.state.message && <code className="recovery-detail">{this.state.message}</code>}
        <div className="recovery-actions">
          <button
            className="button primary"
            onClick={() => this.setState({ failed: false, message: '' })}
          >
            Try again
          </button>
          <button className="button secondary" onClick={() => location.reload()}>
            Reload GestureDeck
          </button>
        </div>
      </main>
    );
  }
}

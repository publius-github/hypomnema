import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorMessage } from "../lib/ipc";
import { logCrash } from "../lib/log";
import { useAppVersion } from "./AboutModal";
import ProblemReport from "./ProblemReport";

interface State {
  error: unknown;
}

/**
 * The last line of defense for a render crash: without it React unmounts
 * everything and leaves a blank window. The data is safe either way - it
 * lives in the Rust core - so the screen says so and offers a reload.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logCrash(`render crash${info.componentStack ?? ""}`, error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return <CrashScreen error={this.state.error} />;
  }
}

function CrashScreen({ error }: { error: unknown }) {
  const version = useAppVersion();
  return (
    <div className="flex h-screen items-center justify-center bg-surface p-4 text-content">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface-alt p-6 shadow-xl">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-content-muted">
          The window hit an error it could not recover from. Your data is
          not affected - it is saved by the app core, not this screen.
          Reloading usually brings everything back.
        </p>
        <pre className="mt-3 max-h-32 select-text overflow-auto whitespace-pre-wrap break-words rounded border border-line p-2 text-xs">
          {errorMessage(error)}
        </pre>
        <button
          className="btn-primary mt-4 w-full"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
        <div className="mt-3">
          <ProblemReport version={version} />
        </div>
      </div>
    </div>
  );
}

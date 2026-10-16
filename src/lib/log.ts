import { errorMessage, logToFile } from "./ipc";

/**
 * For the rejections the UI deliberately does not put in the banner (a
 * cosmetic theme call, an offline update check, an automatic sync pass
 * that will run again): still leave a trace in the WebView console and
 * the diagnostic log, so a swallowed failure can be seen when someone
 * goes looking.
 */
export function warn(context: string, e: unknown): void {
  const line = `${context}: ${errorMessage(e)}`;
  console.warn(line);
  logToFile("warn", line);
}

/** An exception nothing caught: a render crash, an unhandled rejection. */
export function logCrash(context: string, e: unknown): void {
  const stack = e instanceof Error && e.stack ? `\n${e.stack}` : "";
  logToFile("error", `${context}: ${errorMessage(e)}${stack}`);
}

/**
 * Routes window-level errors and unhandled promise rejections into the
 * diagnostic log. Called once per window from main.tsx.
 */
export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (event) => {
    logCrash("uncaught error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    logCrash("unhandled rejection", event.reason);
  });
}

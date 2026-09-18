import { errorMessage } from "./ipc";

/**
 * For the rejections the UI deliberately does not put in the banner (a
 * cosmetic theme call, an offline update check, an automatic sync pass
 * that will run again): still leave a trace in the WebView console, so
 * a swallowed failure can be seen when someone goes looking.
 */
export function warn(context: string, e: unknown): void {
  console.warn(`${context}: ${errorMessage(e)}`);
}

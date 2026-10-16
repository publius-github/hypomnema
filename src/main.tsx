import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CaptureWindow from "./components/CaptureWindow";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorLogging } from "./lib/log";
import "./styles.css";

// the quick-capture window loads the same bundle under #/capture and
// renders only the capture input - no store, engine timers or vault UI
const isCapture = window.location.hash.startsWith("#/capture");

installGlobalErrorLogging();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>{isCapture ? <CaptureWindow /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Defer Sentry init to keep the landing LCP fast — the chunk (~90 KiB)
// loads after first paint, not before.
if (import.meta.env.PROD) {
  const start = () =>
    import("./lib/sentryInit").then((m) => m.initSentry()).catch(() => {});
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (window as Window & typeof globalThis).requestIdleCallback(start, { timeout: 3000 });
  } else {
    setTimeout(start, 1);
  }
}

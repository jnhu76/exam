import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerGlobalErrorCapture } from "@/lib/globalErrorCapture";
import "./i18n";
import "./index.css";
import "./typography/recipes.css";
import "./surface/recipes.css";
import "./table/recipes.css";
import "./table/workbench.css";
import "./badge/recipes.css";
import "./control/recipes.css";
import "./feedback/recipes.css";

// Capture boundary-external errors (event handlers, timers, unhandled
// rejections) before the app mounts so they reach the server pipeline.
registerGlobalErrorCapture();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

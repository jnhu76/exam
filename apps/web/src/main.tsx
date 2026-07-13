import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
import "./index.css";
import "./typography/recipes.css";
import "./surface/recipes.css";
import "./table/recipes.css";
import "./badge/recipes.css";
import "./control/recipes.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

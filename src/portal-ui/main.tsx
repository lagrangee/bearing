import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/find.css";
import "./styles/catalog.css";
import "./styles/planning.css";
import "./styles/overview.css";
import "./styles/roadmaps.css";
import "./styles/assets.css";
import "./styles/audit.css";
import "./styles/lineage.css";

export const startPortal = (): void => {
  const root = document.querySelector("#root");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Bearing Portal root element is missing.");
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

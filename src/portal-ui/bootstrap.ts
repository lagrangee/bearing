import { startPortal } from "./main";

const response = await window.fetch("/api/v1/bootstrap", {
  method: "GET",
  credentials: "same-origin",
  headers: { Accept: "application/json" },
});

if (!response.ok) throw new Error("Bearing Portal session bootstrap failed.");

startPortal();

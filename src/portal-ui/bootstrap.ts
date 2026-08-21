import { portalBootstrapEnvelopeSchema } from "../portal-build-identity-wire";
import { startPortal } from "./main";
import { initializePortalBuildIdentity } from "./portal-build-identity";

const response = await window.fetch("/api/v1/bootstrap", {
  method: "GET",
  credentials: "same-origin",
  headers: { Accept: "application/json" },
});

if (!response.ok) throw new Error("Bearing Portal session bootstrap failed.");
const bootstrap = portalBootstrapEnvelopeSchema.safeParse(await response.json());
if (!bootstrap.success) throw new Error("Bearing Portal bootstrap does not match version 1.");
initializePortalBuildIdentity(bootstrap.data);

startPortal();

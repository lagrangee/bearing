import type { PortalCatalogEnvelope } from "../portal-catalog-wire";
import { portalCatalogEnvelopeSchema } from "../portal-catalog-wire";

export class CatalogResponseError extends Error {
  readonly name = "CatalogResponseError";

  constructor(readonly reason: string) {
    super(reason);
  }
}

export async function readCatalog(signal: AbortSignal): Promise<PortalCatalogEnvelope> {
  const response = await window.fetch("/api/v1/catalog", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new CatalogResponseError(`Catalog request returned ${response.status}.`);
  }
  const parsed = portalCatalogEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new CatalogResponseError("Catalog response does not match version 1.");
  }
  return parsed.data;
}

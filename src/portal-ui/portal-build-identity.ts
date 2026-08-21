import {
  PORTAL_BUILD_IDENTITY_HEADER,
  type PortalBootstrapEnvelope,
  portalBuildIdentitySchema,
} from "../portal-build-identity-wire";

let currentBuildIdentity: string | undefined;
let reloadRequested = false;

export const initializePortalBuildIdentity = (bootstrap: PortalBootstrapEnvelope): void => {
  currentBuildIdentity = bootstrap.portalBuildIdentity;
  reloadRequested = false;
};

const observePortalBuildIdentity = (response: Response): void => {
  const parsed = portalBuildIdentitySchema.safeParse(
    response.headers.get(PORTAL_BUILD_IDENTITY_HEADER),
  );
  if (!parsed.success || currentBuildIdentity === undefined) return;
  if (parsed.data === currentBuildIdentity || reloadRequested) return;
  reloadRequested = true;
  window.location.reload();
};

export const portalGet = async (
  input: RequestInfo | URL,
  init: Omit<RequestInit, "method"> = {},
): Promise<Response> => {
  const response = await window.fetch(input, { ...init, method: "GET" });
  observePortalBuildIdentity(response);
  return response;
};

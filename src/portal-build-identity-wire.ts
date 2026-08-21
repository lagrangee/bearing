import { z } from "zod";

export const PORTAL_BUILD_IDENTITY_HEADER = "X-Bearing-Portal-Build-Identity-V1";

export const portalBuildIdentitySchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const portalBootstrapEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  state: z.literal("ready"),
  portalBuildIdentity: portalBuildIdentitySchema,
});

export type PortalBootstrapEnvelope = Readonly<z.infer<typeof portalBootstrapEnvelopeSchema>>;

import { z } from "zod";
import { portalBuildIdentitySchema } from "./portal-build-identity-wire";

const sha256IdentitySchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const developmentRuntimeHealthIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  channel: z.literal("development"),
  runtimeIdentity: sha256IdentitySchema,
  stateRootIdentity: sha256IdentitySchema,
});

export const developmentPortalIdentitySchema = developmentRuntimeHealthIdentitySchema.extend({
  portalBuildIdentity: portalBuildIdentitySchema,
});

export const developmentPortalHealthSchema = z.strictObject({
  state: z.literal("ready"),
  packageVersion: z.string().min(1),
  readModelVersion: z.number().int().positive(),
  development: developmentPortalIdentitySchema,
});

export type DevelopmentRuntimeHealthIdentity = Readonly<
  z.infer<typeof developmentRuntimeHealthIdentitySchema>
>;

export type DevelopmentPortalHealth = Readonly<z.infer<typeof developmentPortalHealthSchema>>;

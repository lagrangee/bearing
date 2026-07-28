import { z } from "zod";
import type { ProviderConfiguration } from "./native-work-provider";
import { MATT_SKILLS_V1_PROVIDER_ID } from "./providers/matt-skills-v1/capture";
import { displaySourceLocatorSchema } from "./reference-schema";

export const mattProviderConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.literal(MATT_SKILLS_V1_PROVIDER_ID),
  contractLocator: displaySourceLocatorSchema,
});

export type MattProviderConfigurationFile = Readonly<
  z.infer<typeof mattProviderConfigurationSchema>
>;

export type MattProviderConfiguration = ProviderConfiguration<typeof MATT_SKILLS_V1_PROVIDER_ID>;

export const decodeMattProviderConfiguration = (
  source: string,
): MattProviderConfigurationFile | undefined => {
  try {
    return mattProviderConfigurationSchema.parse(JSON.parse(source));
  } catch {
    return undefined;
  }
};

export const providerConfigurationFor = (
  file: MattProviderConfigurationFile,
): MattProviderConfiguration => ({
  provider: file.provider,
  contractLocator: file.contractLocator,
});

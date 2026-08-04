import type {
  NativeWorkProvider,
  ProviderScopeObservation,
  WorkBinding,
} from "../../native-work-provider";
import type { MattScopeProjection } from "./model";

export const MATT_SKILLS_V1_PROVIDER_ID = "matt-skills/v1" as const;

export type MattSkillsV1WorkBinding = WorkBinding<typeof MATT_SKILLS_V1_PROVIDER_ID>;
export type MattSkillsV1ProviderObservation = ProviderScopeObservation<
  typeof MATT_SKILLS_V1_PROVIDER_ID,
  MattScopeProjection
>;
export type MattSkillsV1Provider = NativeWorkProvider<
  typeof MATT_SKILLS_V1_PROVIDER_ID,
  MattScopeProjection
>;

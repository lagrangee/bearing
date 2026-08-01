import { resolveRepositoryRoot } from "./path-boundary";
import {
  inspectRepositoryIntegrationLifecycle,
  type RepositoryIntegrationLifecycle,
} from "./repository-integration-lifecycle";

export const ACTIVATION_ORIGINS = ["explicit", "model-invoked"] as const;
export type ActivationOrigin = (typeof ACTIVATION_ORIGINS)[number];

export type ActivationDisposition =
  | "continue-bearing"
  | "continue-without-bearing"
  | "enter-reactivation"
  | "enter-recovery"
  | "enter-setup"
  | "invoke-bearing"
  | "stop-for-explicit-entry";

export type ActivationCheck = Readonly<{
  schemaVersion: 1;
  origin: ActivationOrigin;
  lifecycle: RepositoryIntegrationLifecycle;
  modelInvokedEligible: boolean;
  disposition: ActivationDisposition;
}>;

const modelInvokedDisposition = (
  lifecycle: RepositoryIntegrationLifecycle["kind"],
): ActivationDisposition => {
  if (lifecycle === "active") return "invoke-bearing";
  if (lifecycle === "invalid-or-unsupported") return "stop-for-explicit-entry";
  return "continue-without-bearing";
};

const explicitDisposition = (
  lifecycle: RepositoryIntegrationLifecycle["kind"],
): ActivationDisposition => {
  if (lifecycle === "active") return "continue-bearing";
  if (lifecycle === "fresh") return "enter-setup";
  if (lifecycle === "deactivated") return "enter-reactivation";
  return "enter-recovery";
};

export const decideBearingActivation = (
  origin: ActivationOrigin,
  lifecycle: RepositoryIntegrationLifecycle,
): ActivationCheck => ({
  schemaVersion: 1,
  origin,
  lifecycle,
  modelInvokedEligible: lifecycle.kind === "active",
  disposition:
    origin === "model-invoked"
      ? modelInvokedDisposition(lifecycle.kind)
      : explicitDisposition(lifecycle.kind),
});

export const checkBearingActivation = async (
  repoRoot: string,
  origin: ActivationOrigin,
): Promise<ActivationCheck> => {
  const root = await resolveRepositoryRoot(repoRoot);
  return decideBearingActivation(origin, await inspectRepositoryIntegrationLifecycle(root));
};

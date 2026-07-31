import { z } from "zod";
import {
  providerObservationSelectionFreshnessIsCoherent,
  providerObservationSelectionSchema,
} from "../provider-observation-contract";
import {
  mattNativeScopeKey,
  sameMattNativeBindingDefinition,
} from "../providers/matt-skills-v1/native-subject";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import { uniqueIdentityArraySchema } from "./projection-identity";

export const nativeScopeInspectionProjectionSchema = z
  .strictObject({
    observations: uniqueIdentityArraySchema(mattSkillsV1ProviderObservationSchema, (observation) =>
      mattNativeScopeKey(observation.binding),
    ),
    selections: uniqueIdentityArraySchema(providerObservationSelectionSchema, mattNativeScopeKey),
  })
  .superRefine((projection, context) => {
    for (const [index, selection] of projection.selections.entries()) {
      if (
        selection.latestAttempt !== null &&
        selection.latestAttempt.intent !== "native-scope-inspection"
      ) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "latestAttempt", "intent"],
          message: "Native scope inspection attempts must retain their inspection intent.",
        });
      }
      if (selection.observationId === null) continue;
      const observation = projection.observations.find(
        (candidate) => candidate.id === selection.observationId,
      );
      if (
        observation === undefined ||
        !sameMattNativeBindingDefinition(observation.binding, selection)
      ) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "observationId"],
          message: "Every native scope inspection selection must resolve in its exact scope.",
        });
      } else if (!providerObservationSelectionFreshnessIsCoherent(selection, observation)) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "effectiveFreshness"],
          message:
            "A native scope inspection selection cannot claim fresher evidence than its selected observation.",
        });
      }
    }
    for (const [index, observation] of projection.observations.entries()) {
      if (
        !projection.selections.some(
          (selection) =>
            selection.observationId === observation.id &&
            sameMattNativeBindingDefinition(selection, observation.binding),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "id"],
          message: "Every native scope inspection observation must be selected.",
        });
      }
    }
  });

import { z } from "zod";
import type { ProviderObservationSelection } from "../provider-evidence-contract";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import {
  assertProjectReadModelObjectIdentity,
  type ProjectReadModelObject,
  projectReadModelObjectSchema,
} from "./contract";

const nativeEvidenceReferenceSchema = z.strictObject({
  id: z.string().startsWith("portal-native-evidence:"),
  subjectReference: z.string().min(1),
  role: z.enum(["bound", "detail"]),
  bindingKey: z.string().min(1),
});

// Stored subject rows refer to the unique evidence for their Binding and role. Hydration
// preserves the public typed row contract without parsing or copying each observation again.
export const readProjectReadModelObject = (
  row: Readonly<{ reference: string; kind: string; payload: string }>,
  evidenceFor: (
    bindingKey: string,
    role: "bound" | "detail",
  ) =>
    | Readonly<{
        bindingKey: string;
        role: "bound" | "detail";
        selection: ProviderObservationSelection;
        observation?: MattSkillsV1ProviderObservation;
      }>
    | undefined,
): ProjectReadModelObject => {
  const value: unknown = JSON.parse(row.payload);
  let object: ProjectReadModelObject;
  if (row.kind === "portal-native-evidence") {
    const reference = nativeEvidenceReferenceSchema.parse(value);
    const evidence = evidenceFor(reference.bindingKey, reference.role);
    if (
      evidence === undefined ||
      evidence.bindingKey !== reference.bindingKey ||
      evidence.role !== reference.role
    ) {
      throw new Error("Project Read Model native evidence reference is missing or inconsistent.");
    }
    object = {
      kind: "portal-native-evidence",
      value: {
        id: reference.id,
        subjectReference: reference.subjectReference,
        role: reference.role,
        selection: evidence.selection,
        ...(evidence.observation === undefined ? {} : { observation: evidence.observation }),
      },
    } as ProjectReadModelObject;
  } else {
    object = projectReadModelObjectSchema.parse({ kind: row.kind, value });
  }
  assertProjectReadModelObjectIdentity(row.reference, object);
  return object;
};

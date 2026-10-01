import { readProjectReadModelObject } from "../../src/project-read-model/object-row";
import type { ProjectReadModelCandidate } from "../../src/project-read-model/store";
import { providerObservationSelectionSchema } from "../../src/provider-evidence-contract";
import type { MattSkillsV1ProviderObservation } from "../../src/providers/matt-skills-v1/capture";
import { mattSkillsV1ProviderObservationSchema } from "../../src/providers/matt-skills-v1/schema";

export const projectReadModelCandidateObjects = (candidate: ProjectReadModelCandidate) => {
  const evidence = new Map(
    candidate.providerEvidence.map((row) => [
      `${row.role}:${row.bindingKey}`,
      {
        bindingKey: row.bindingKey,
        role: row.role,
        selection: providerObservationSelectionSchema.parse(JSON.parse(row.selection)),
        ...(row.observation === undefined
          ? {}
          : {
              observation: mattSkillsV1ProviderObservationSchema.parse(
                JSON.parse(row.observation),
              ) as MattSkillsV1ProviderObservation,
            }),
      },
    ]),
  );
  return candidate.objects.map((row) =>
    readProjectReadModelObject(row, (bindingKey, role) => evidence.get(`${role}:${bindingKey}`)),
  );
};

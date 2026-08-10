import { z } from "zod";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { roadmapIdSchema } from "./schema-primitives";
import { sourceReferenceSchema } from "./source-schema";

const roadmapIds = uniqueIdentityArraySchema(roadmapIdSchema, (roadmapId) => roadmapId);

export const roadmapIndexSchema = z
  .strictObject({
    source: sourceReferenceSchema,
    activeRoadmapIds: roadmapIds,
    completedRoadmapIds: roadmapIds,
    supersededRoadmapIds: roadmapIds,
  })
  .superRefine((index, context) => {
    const seen = new Set<string>();
    for (const [field, ids] of [
      ["activeRoadmapIds", index.activeRoadmapIds],
      ["completedRoadmapIds", index.completedRoadmapIds],
      ["supersededRoadmapIds", index.supersededRoadmapIds],
    ] as const) {
      for (const [position, id] of ids.entries()) {
        if (seen.has(id)) {
          context.addIssue({
            code: "custom",
            path: [field, position],
            message: "One Roadmap cannot occupy multiple Index lifecycle groups.",
          });
        }
        seen.add(id);
      }
    }
  });

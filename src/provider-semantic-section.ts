import { z } from "zod";

export const PROVIDER_SEMANTIC_SECTION_VERSION = 1 as const;

export type ProviderSemanticSection = Readonly<{
  version: typeof PROVIDER_SEMANTIC_SECTION_VERSION;
  sourceIdentity: string;
  title: string;
  sourceOrder: number;
  semanticRole?: string | undefined;
  availability: "available" | "confirmed-empty" | "unavailable" | "unsupported";
  markdown: string;
}>;

const identity = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);

export const providerSemanticSectionSchema: z.ZodType<ProviderSemanticSection> = z
  .strictObject({
    version: z.literal(PROVIDER_SEMANTIC_SECTION_VERSION),
    sourceIdentity: identity,
    title: z.string().min(1),
    sourceOrder: z.number().int().nonnegative(),
    semanticRole: identity.optional(),
    availability: z.enum(["available", "confirmed-empty", "unavailable", "unsupported"]),
    markdown: z.string(),
  })
  .superRefine((section, context) => {
    const hasContent = section.markdown.trim().length > 0;
    if (section.availability === "available" ? hasContent : !hasContent) return;
    context.addIssue({
      code: "custom",
      path: ["markdown"],
      message:
        section.availability === "available"
          ? "An available Provider Semantic Section requires Markdown."
          : "A non-available Provider Semantic Section cannot carry Markdown.",
    });
  });

export const providerSemanticSectionsSchema = z
  .array(providerSemanticSectionSchema)
  .superRefine((sections, context) => {
    const identities = new Set<string>();
    const roles = new Set<string>();
    for (const [index, section] of sections.entries()) {
      if (section.sourceOrder !== index) {
        context.addIssue({
          code: "custom",
          path: [index, "sourceOrder"],
          message: "Provider Semantic Sections must keep contiguous source order.",
        });
      }
      if (identities.has(section.sourceIdentity)) {
        context.addIssue({
          code: "custom",
          path: [index, "sourceIdentity"],
          message: "Provider Semantic Section source identities must be unique.",
        });
      }
      identities.add(section.sourceIdentity);
      if (section.semanticRole === undefined) continue;
      if (roles.has(section.semanticRole)) {
        context.addIssue({
          code: "custom",
          path: [index, "semanticRole"],
          message: "Provider Semantic Section roles must be unique.",
        });
      }
      roles.add(section.semanticRole);
    }
  });

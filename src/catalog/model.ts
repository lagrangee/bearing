import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { CatalogAvailability } from "./availability";
import { catalogEntryIdSchema } from "./entry-id";

const normalizedAbsolutePath = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value) && resolve(value) === value, {
    message: "Catalog repository root must be a normalized absolute path.",
  });

export const catalogEntrySchema = z.strictObject({
  entryId: catalogEntryIdSchema,
  repoRoot: normalizedAbsolutePath,
  displayName: z.string().trim().min(1),
});

export const catalogDocumentSchema = z
  .strictObject({
    version: z.literal(1),
    entries: z.array(catalogEntrySchema),
  })
  .superRefine((document, context) => {
    const ids = new Set<string>();
    const roots = new Set<string>();
    for (const [index, entry] of document.entries.entries()) {
      if (ids.has(entry.entryId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "entryId"],
          message: "Catalog entry identity must be unique.",
        });
      }
      if (roots.has(entry.repoRoot)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "repoRoot"],
          message: "Catalog repository root must be unique.",
        });
      }
      ids.add(entry.entryId);
      roots.add(entry.repoRoot);
    }
  });

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
export type ProbedCatalogEntry = CatalogEntry &
  Readonly<{
    availability: CatalogAvailability;
    detail?: string;
  }>;

export const emptyCatalogDocument = (): CatalogDocument => ({ version: 1, entries: [] });

export const parseCatalogDocument = (input: unknown): CatalogDocument =>
  catalogDocumentSchema.parse(input);

export const parseCatalogRepositoryRoot = (input: unknown): string =>
  normalizedAbsolutePath.parse(input);

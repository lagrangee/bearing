import { z } from "zod";

export const catalogEntryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

export type CatalogEntryId = z.infer<typeof catalogEntryIdSchema>;

export const parseCatalogEntryId = (input: unknown): CatalogEntryId =>
  catalogEntryIdSchema.parse(input);

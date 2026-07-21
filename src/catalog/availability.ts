import { z } from "zod";

export const catalogAvailabilitySchema = z.enum([
  "available",
  "missing",
  "unreadable",
  "manifest-missing",
  "invalid-manifest",
]);

export type CatalogAvailability = z.infer<typeof catalogAvailabilitySchema>;

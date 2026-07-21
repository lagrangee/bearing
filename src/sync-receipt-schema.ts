import { z } from "zod";

export const SYNC_RECEIPT_SCHEMA_VERSION = 1 as const;

const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const producerSchema = z
  .strictObject({
    packageName: z.string().min(1),
    packageVersion: z.string().min(1),
  })
  .readonly();
const sitemapBasisSchema = z
  .strictObject({
    version: z.literal(1),
    fingerprint: fingerprintSchema,
  })
  .readonly();

export const syncReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(SYNC_RECEIPT_SCHEMA_VERSION),
    producer: producerSchema,
    completedAt: z.iso.datetime({ offset: true }),
    sitemap: sitemapBasisSchema,
    reconciliation: z.union([z.literal("applied"), z.literal("no-op")]),
  })
  .readonly();

export type SyncReceipt = z.infer<typeof syncReceiptSchema>;
export type SyncReceiptCompletion = Readonly<{
  producer: SyncReceipt["producer"];
  completedAt: string;
  sitemap: SyncReceipt["sitemap"];
  reconciliation: SyncReceipt["reconciliation"];
}>;

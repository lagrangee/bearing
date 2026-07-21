import { z } from "zod";
import { assetSchema } from "./schema-definitions";

export type ParsedAsset = z.infer<typeof assetSchema>;
export type AssetEntry = Readonly<{
  key: string;
  title: string;
  data: ParsedAsset | undefined;
}>;
export type AssetRegistryParse =
  | Readonly<{ ok: true; entries: readonly AssetEntry[] }>
  | Readonly<{ ok: false }>;

const registryEnvelope = z.looseObject({
  Type: z.literal("asset-registry"),
  Assets: z.array(z.unknown()),
});

const rawText = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : undefined;
};

export const parseAssetRegistry = (value: unknown): AssetRegistryParse => {
  const registry = registryEnvelope.safeParse(value);
  if (!registry.success) return { ok: false };
  return {
    ok: true,
    entries: registry.data.Assets.map((candidate, index) => {
      const id = rawText(candidate, "ID");
      const title = rawText(candidate, "Title") ?? id ?? `Asset entry ${index + 1}`;
      const parsed = assetSchema.safeParse(candidate);
      return {
        key: id === undefined || id.length === 0 ? `entry-${index + 1}` : id,
        title,
        data: parsed.success ? parsed.data : undefined,
      };
    }),
  };
};

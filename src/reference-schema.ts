import { z } from "zod";

export const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0);

export const displaySourceLocatorSchema = z
  .string()
  .min(1)
  .superRefine((locator, context) => {
    const segments = locator.split("/");
    if (
      locator.includes("\0") ||
      locator.startsWith("/") ||
      locator.includes("\\") ||
      segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Source locators must be normalized repository-relative POSIX paths.",
      });
    }
  });

export const displayAssetLocatorSchema = displaySourceLocatorSchema.refine(
  (locator) => !locator.includes(":"),
  {
    message:
      "Asset Locations must be repository-relative local paths, not URLs or opaque references.",
  },
);

const httpsAssetLocatorSchema = z
  .url()
  .startsWith("https://")
  .superRefine((locator, context) => {
    if (!URL.canParse(locator)) return;
    const parsed = new URL(locator);
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      context.addIssue({
        code: "custom",
        message: "HTTPS Asset Sources cannot contain credentials.",
      });
    }
  });

export const assetSourceLocatorSchema = z.union([
  displayAssetLocatorSchema,
  httpsAssetLocatorSchema,
]);

const trackerReferenceLocatorSchema = displaySourceLocatorSchema.refine(
  (locator) => !locator.includes(":"),
  { message: "Tracker references cannot contain Stable ID separators." },
);

export const planningReferenceSchema = z.union([
  z.string().regex(/^[a-z][a-z-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  trackerReferenceLocatorSchema,
]);

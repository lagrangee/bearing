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

const trackerReferenceLocatorSchema = displaySourceLocatorSchema.refine(
  (locator) => !locator.includes(":"),
  { message: "Tracker references cannot contain Stable ID separators." },
);

export const planningReferenceSchema = z.union([
  z.string().regex(/^[a-z][a-z-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  trackerReferenceLocatorSchema,
]);

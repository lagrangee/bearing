import { z } from "zod";

export const languageTagSchema = z
  .string()
  .trim()
  .min(1)
  .transform((language, context) => {
    try {
      const canonical = Intl.getCanonicalLocales(language)[0];
      if (canonical !== undefined) return canonical;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    context.addIssue({ code: "custom", message: "Expected a valid BCP-47 language tag." });
    return z.NEVER;
  });

import { z } from "zod";

export const NATIVE_SCOPE_DISCOVERY_PROVIDER = "matt-skills/v1" as const;

export const nativeSubjectSummarySchema = z.strictObject({
  identity: z.string().min(1),
  locator: z.string().min(1),
  title: z.string().min(1),
  classification: z.enum([
    "map",
    "spec",
    "wayfinder",
    "delivery",
    "incoming",
    "request",
    "unknown",
  ]),
  lifecycle: z.enum(["open", "closed", "unknown"]),
  parentIdentity: z.string().min(1).nullable(),
  admission: z.array(z.string().min(1)),
});

export const discoveredNativeScopeSchema = z
  .strictObject({
    identity: z.string().min(1),
    binding: z.strictObject({
      provider: z.literal(NATIVE_SCOPE_DISCOVERY_PROVIDER),
      nativeScope: z.string().min(1),
    }),
    locator: z.string().min(1),
    driver: z.enum(["local", "github"]),
    rootRole: z.enum(["wayfinder-map", "parent-scope", "standalone-request", "unknown"]),
    title: z.string().min(1),
    lifecycle: z.enum(["open", "closed", "mixed", "unknown"]),
    classification: z.enum([
      "map",
      "spec",
      "wayfinder",
      "delivery",
      "incoming",
      "request",
      "unknown",
    ]),
    admission: z.array(z.string().min(1)),
    subjects: z.array(nativeSubjectSummarySchema),
  })
  .superRefine((scope, context) => {
    const identities = new Set<string>();
    for (const [index, subject] of scope.subjects.entries()) {
      if (identities.has(subject.identity)) {
        context.addIssue({
          code: "custom",
          path: ["subjects", index, "identity"],
          message: "Native subject identities must be unique within a scope.",
        });
      }
      identities.add(subject.identity);
    }
    for (const [index, subject] of scope.subjects.entries()) {
      if (subject.parentIdentity !== null && !identities.has(subject.parentIdentity)) {
        context.addIssue({
          code: "custom",
          path: ["subjects", index, "parentIdentity"],
          message: "Native subject parents must resolve within the same scope.",
        });
      }
    }
    const parentByIdentity = new Map(
      scope.subjects.map((subject) => [subject.identity, subject.parentIdentity]),
    );
    for (const [index, subject] of scope.subjects.entries()) {
      const lineage = new Set<string>();
      let current: string | null | undefined = subject.identity;
      while (current !== null && current !== undefined) {
        if (lineage.has(current)) {
          context.addIssue({
            code: "custom",
            path: ["subjects", index, "parentIdentity"],
            message: "Native subject hierarchy must be acyclic.",
          });
          break;
        }
        lineage.add(current);
        current = parentByIdentity.get(current);
      }
    }
  });

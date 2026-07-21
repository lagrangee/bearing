import type { RefinementCtx } from "zod";
import { createSourceReference } from "./source-reference";
import { sourceRecordSchema } from "./source-schema";

type Path = readonly (string | number)[];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const reportDanglingReference = (context: RefinementCtx, path: Path): void => {
  context.addIssue({
    code: "custom",
    path: [...path],
    message: "Every Source Reference must resolve to the Snapshot Source table.",
  });
};

const validateReferenceClosure = (
  value: unknown,
  path: Path,
  knownReferences: ReadonlySet<string>,
  context: RefinementCtx,
): void => {
  if (Array.isArray(value)) {
    for (const [position, item] of value.entries()) {
      validateReferenceClosure(item, [...path, position], knownReferences, context);
    }
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (key === "source" && typeof child === "string") {
      if (!knownReferences.has(child)) reportDanglingReference(context, childPath);
      continue;
    }
    if (key === "evidenceSourceReferences" && Array.isArray(child)) {
      for (const [position, reference] of child.entries()) {
        if (typeof reference === "string" && !knownReferences.has(reference)) {
          reportDanglingReference(context, [...childPath, position]);
        }
      }
      continue;
    }
    validateReferenceClosure(child, childPath, knownReferences, context);
  }
};

export const validateSourceConsistency = (snapshot: unknown, context: RefinementCtx): void => {
  if (!isRecord(snapshot) || !isRecord(snapshot["basis"]) || !Array.isArray(snapshot["sources"])) {
    return;
  }
  const fingerprint = snapshot["basis"]["sitemapFingerprint"];
  if (typeof fingerprint !== "string") return;

  const knownReferences = new Set<string>();
  for (const [position, source] of snapshot["sources"].entries()) {
    const parsed = sourceRecordSchema.safeParse(source);
    if (!parsed.success) continue;
    knownReferences.add(parsed.data.reference);
    const expected = createSourceReference({
      basisFingerprint: fingerprint,
      kind: parsed.data.kind,
      displayLocator: parsed.data.displayLocator,
      ...(parsed.data.fragment === undefined ? {} : { fragment: parsed.data.fragment }),
      ...(parsed.data.binding === undefined ? {} : { binding: parsed.data.binding }),
    });
    if (expected !== parsed.data.reference) {
      context.addIssue({
        code: "custom",
        path: ["sources", position, "reference"],
        message: "A Source Record reference must match its current basis and locator.",
      });
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== "sources") validateReferenceClosure(value, [key], knownReferences, context);
  }
};

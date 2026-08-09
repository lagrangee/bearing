import { z } from "zod";

export const DOCUMENT_PRESENTATION_VERSION = 1 as const;

export type DocumentPresentationInline =
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "strong"; inlines: readonly DocumentPresentationInline[] }>
  | Readonly<{ kind: "emphasis"; inlines: readonly DocumentPresentationInline[] }>
  | Readonly<{ kind: "inline-code"; value: string }>
  | Readonly<{
      kind: "link";
      href: string;
      title?: string | undefined;
      inlines: readonly DocumentPresentationInline[];
    }>;

export type DocumentPresentationList = Readonly<{
  kind: "list";
  style: "ordered" | "unordered";
  start?: number | undefined;
  items: readonly Readonly<{
    inlines: readonly DocumentPresentationInline[];
    children: readonly DocumentPresentationList[];
  }>[];
}>;

export type DocumentPresentationBlock =
  | Readonly<{ kind: "paragraph"; inlines: readonly DocumentPresentationInline[] }>
  | Readonly<{
      kind: "heading";
      level: 3 | 4 | 5 | 6;
      inlines: readonly DocumentPresentationInline[];
    }>
  | DocumentPresentationList;

export type DocumentPresentationSection = Readonly<{
  sourceIdentity: string;
  title: string;
  sourceOrder: number;
  semanticRole?: string | undefined;
  availability: "available" | "confirmed-empty" | "unavailable";
  blocks: readonly DocumentPresentationBlock[];
}>;

export type DocumentPresentation = Readonly<{
  version: typeof DOCUMENT_PRESENTATION_VERSION;
  sections: readonly DocumentPresentationSection[];
}>;

export const isSafeDocumentPresentationHref = (href: string): boolean => {
  if (
    href.length === 0 ||
    href.trim() !== href ||
    [...href].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    return false;
  }
  try {
    const protocol = new URL(href, "https://bearing.invalid/").protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
};

export const isExternalDocumentPresentationHref = (href: string): boolean => {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
};

const nonEmpty = z.string().min(1);
const identity = nonEmpty.regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);

const documentPresentationInlineSchema: z.ZodType<DocumentPresentationInline> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("text"), value: nonEmpty }),
    z.strictObject({
      kind: z.literal("strong"),
      inlines: z.array(documentPresentationInlineSchema).min(1),
    }),
    z.strictObject({
      kind: z.literal("emphasis"),
      inlines: z.array(documentPresentationInlineSchema).min(1),
    }),
    z.strictObject({ kind: z.literal("inline-code"), value: nonEmpty }),
    z.strictObject({
      kind: z.literal("link"),
      href: nonEmpty.refine(isSafeDocumentPresentationHref, {
        message: "Document links must use a safe HTTP, HTTPS, mailto, or relative target.",
      }),
      title: nonEmpty.optional(),
      inlines: z.array(documentPresentationInlineSchema).min(1),
    }),
  ]),
);

const documentPresentationListSchema: z.ZodType<DocumentPresentationList> = z.lazy(() =>
  z
    .strictObject({
      kind: z.literal("list"),
      style: z.enum(["ordered", "unordered"]),
      start: z.number().int().positive().optional(),
      items: z
        .array(
          z.strictObject({
            inlines: z.array(documentPresentationInlineSchema).min(1),
            children: z.array(documentPresentationListSchema),
          }),
        )
        .min(1),
    })
    .superRefine((list, context) => {
      if (list.style === "ordered" || list.start === undefined) return;
      context.addIssue({
        code: "custom",
        path: ["start"],
        message: "Only an ordered document list can declare a start value.",
      });
    }),
);

const documentPresentationBlockSchema: z.ZodType<DocumentPresentationBlock> = z.union([
  z.strictObject({
    kind: z.literal("paragraph"),
    inlines: z.array(documentPresentationInlineSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("heading"),
    level: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    inlines: z.array(documentPresentationInlineSchema).min(1),
  }),
  documentPresentationListSchema,
]);

export const documentPresentationSectionSchema: z.ZodType<DocumentPresentationSection> = z
  .strictObject({
    sourceIdentity: identity,
    title: nonEmpty,
    sourceOrder: z.number().int().nonnegative(),
    semanticRole: identity.optional(),
    availability: z.enum(["available", "confirmed-empty", "unavailable"]),
    blocks: z.array(documentPresentationBlockSchema),
  })
  .superRefine((section, context) => {
    const hasBlocks = section.blocks.length > 0;
    if (
      !(
        (section.availability === "available" && hasBlocks) ||
        (section.availability !== "available" && !hasBlocks)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["blocks"],
        message:
          section.availability === "available"
            ? "An available document section must contain typed blocks."
            : "A non-available document section must not contain typed blocks.",
      });
    }
    let priorHeadingLevel = 2;
    for (const [index, block] of section.blocks.entries()) {
      if (block.kind !== "heading") continue;
      if (block.level > priorHeadingLevel + 1) {
        context.addIssue({
          code: "custom",
          path: ["blocks", index, "level"],
          message: "Document headings must not skip a level below the Portal-owned H2.",
        });
      }
      priorHeadingLevel = block.level;
    }
  });

export const documentPresentationSchema: z.ZodType<DocumentPresentation> = z
  .strictObject({
    version: z.literal(DOCUMENT_PRESENTATION_VERSION),
    sections: z.array(documentPresentationSectionSchema),
  })
  .superRefine((document, context) => {
    const identities = new Set<string>();
    const semanticRoles = new Set<string>();
    let priorOrder = -1;
    for (const [index, section] of document.sections.entries()) {
      if (identities.has(section.sourceIdentity)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "sourceIdentity"],
          message: "Document section source identity must be unique.",
        });
      }
      identities.add(section.sourceIdentity);
      if (section.semanticRole !== undefined) {
        if (semanticRoles.has(section.semanticRole)) {
          context.addIssue({
            code: "custom",
            path: ["sections", index, "semanticRole"],
            message: "Document section semantic role must be unique.",
          });
        }
        semanticRoles.add(section.semanticRole);
      }
      if (section.sourceOrder <= priorOrder) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "sourceOrder"],
          message: "Document sections must remain in strict source order.",
        });
      }
      priorOrder = section.sourceOrder;
    }
  });

const inlinePlainText = (inlines: readonly DocumentPresentationInline[]): string =>
  inlines
    .map((inline) =>
      inline.kind === "text" || inline.kind === "inline-code"
        ? inline.value
        : inlinePlainText(inline.inlines),
    )
    .join("");

const listPlainText = (list: DocumentPresentationList): string =>
  list.items
    .map((item) =>
      [inlinePlainText(item.inlines), ...item.children.map(listPlainText)]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");

export const documentPresentationBlocksPlainText = (
  blocks: readonly DocumentPresentationBlock[],
): string =>
  blocks
    .map((block) => (block.kind === "list" ? listPlainText(block) : inlinePlainText(block.inlines)))
    .filter(Boolean)
    .join("\n\n");

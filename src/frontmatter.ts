import { parseDocument } from "yaml";
import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

export type FrontmatterResult =
  | Readonly<{
      ok: true;
      data: Readonly<Record<string, unknown>>;
      body: string;
    }>
  | Readonly<{ ok: false; reason: "missing" | "malformed" }>;

export const parseFrontmatter = (source: string): FrontmatterResult => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (match === null) {
    return { ok: false, reason: "missing" };
  }
  const yamlSource = match[1];
  const body = match[2];
  if (yamlSource === undefined || body === undefined) {
    return { ok: false, reason: "missing" };
  }

  const document = parseDocument(yamlSource, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return { ok: false, reason: "malformed" };
  }
  const parsed = recordSchema.safeParse(document.toJS());
  if (!parsed.success) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, data: parsed.data, body };
};

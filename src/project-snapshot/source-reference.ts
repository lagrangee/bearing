import { sha256Hex } from "../sha256";
import {
  type SourceReference,
  type SourceReferenceSeed,
  sourceReferenceSchema,
  sourceReferenceSeedSchema,
} from "./source-schema";

export {
  displayAssetLocatorSchema,
  displaySourceLocatorSchema,
  SOURCE_BINDING_ROLES,
  SOURCE_KINDS,
  type SourceBinding,
  type SourceBindingRole,
  type SourceKind,
  type SourceReference,
  type SourceReferenceSeed,
  sourceBindingRoleSchema,
  sourceBindingSchema,
  sourceKindSchema,
  sourceRecordSchema,
  sourceReferenceSchema,
  sourceReferenceSeedSchema,
} from "./source-schema";

export const createSourceReference = (seed: SourceReferenceSeed): SourceReference => {
  const parsed = sourceReferenceSeedSchema.parse(seed);
  const payload = JSON.stringify([
    parsed.basisFingerprint,
    parsed.kind,
    parsed.displayLocator,
    parsed.fragment ?? null,
    parsed.binding === undefined ? null : [parsed.binding.role, parsed.binding.identity],
  ]);
  const digest = sha256Hex(payload);
  return sourceReferenceSchema.parse(`source:${digest}`);
};

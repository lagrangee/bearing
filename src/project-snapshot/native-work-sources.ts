import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import {
  mattNativeScopeLocator,
  mattNativeScopeSubject,
  mattNativeSubjectForObject,
} from "../providers/matt-skills-v1/native-subject";
import { mattObjectLocator, mattObjects } from "../providers/matt-skills-v1/projection";
import type { SourceRecord } from "./contract";
import { createSourceRecord } from "./source-records";

export const buildMattNativeSourceRecords = (
  observations: readonly MattSkillsV1ProviderObservation[],
  sitemapFingerprint: string,
): readonly SourceRecord[] =>
  observations.flatMap((observation) => {
    const scope = mattNativeScopeSubject(observation);
    const scopeSource = createSourceRecord(sitemapFingerprint, {
      kind: "tracker",
      locator: mattNativeScopeLocator(observation),
      binding: { role: "native-scope", identity: scope.id },
    });
    const objectSources = mattObjects(observation).map((object) => {
      const subject = mattNativeSubjectForObject(object);
      return createSourceRecord(sitemapFingerprint, {
        kind: "tracker",
        locator: mattObjectLocator(object),
        binding: { role: object.kind, identity: subject.id },
      });
    });
    return [scopeSource, ...objectSources];
  });

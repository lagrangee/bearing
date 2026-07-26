import { expect, test } from "bun:test";
import { assessScopedProjectionIssues } from "../src/project-snapshot/scoped-native-relations";

const sources = [
  { reference: "source-effort", displayLocator: ".bearing/state/efforts/test.md" },
  { reference: "source-map", displayLocator: ".scratch/work/map.md" },
];

test("attributes native projection issues through Snapshot source references", () => {
  expect(
    assessScopedProjectionIssues(
      {
        validity: "partial",
        issues: [
          { code: "target", target: ".scratch/work/broken.md" },
          { code: "source", target: "maps", source: "source-map" },
          { code: "other", target: ".scratch/other/map.md" },
        ],
      },
      [{ source: "source-effort", nativeScope: ".scratch/work" }],
      sources,
      { unscopableIsUncertain: true },
    ),
  ).toEqual({ missingRelationCount: 2, uncertain: true });

  expect(
    assessScopedProjectionIssues(
      { validity: "partial", issues: [{ code: "unknown", target: "maps" }] },
      [{ source: "source-effort", nativeScope: ".scratch/work" }],
      sources,
      { unscopableIsUncertain: false },
    ),
  ).toEqual({ missingRelationCount: 0, uncertain: false });
});

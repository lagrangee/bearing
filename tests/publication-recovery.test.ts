import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import {
  bootstrapFrozenPackage,
  type FrozenPublication,
  type PublicationObservation,
  type PublicationSurfaces,
  recoverFrozenPublication,
} from "../scripts/publication-recovery";

const frozen: FrozenPublication = {
  packageName: "@lagrangee/bearing",
  version: "0.1.0",
  sourceCommit: "a".repeat(40),
  artifactPath: "/fixture/lagrangee-bearing-0.1.0.tgz",
  npmShasum: "b".repeat(40),
  npmIntegrity: "sha512-frozen",
  releaseTag: "v0.1.0",
  releaseTitle: "@lagrangee/bearing 0.1.0",
  releaseNotesPath: "/fixture/release-notes.md",
  releaseNotes: "Frozen release notes.\n",
  releaseAssets: [
    {
      path: "/fixture/lagrangee-bearing-0.1.0.tgz",
      name: "lagrangee-bearing-0.1.0.tgz",
      size: 3,
      sha256: "1".repeat(64),
    },
    {
      path: "/fixture/candidate-receipt.json",
      name: "candidate-receipt.json",
      size: 4,
      sha256: "2".repeat(64),
    },
    {
      path: "/fixture/candidate-manifest.json",
      name: "candidate-manifest.json",
      size: 5,
      sha256: "3".repeat(64),
    },
    {
      path: "/fixture/release-notes.md",
      name: "release-notes.md",
      size: 6,
      sha256: "4".repeat(64),
    },
  ],
};

const exactNpm = {
  name: frozen.packageName,
  version: frozen.version,
  shasum: frozen.npmShasum,
  integrity: frozen.npmIntegrity,
  latest: frozen.version,
  provenanceUrl: "https://registry.npmjs.org/-/npm/v1/attestations/@lagrangee%2fbearing@0.1.0",
  provenancePredicateType: "https://slsa.dev/provenance/v1",
};
const exactTag = { tag: frozen.releaseTag, targetCommit: frozen.sourceCommit };
const exactRelease = {
  tag: frozen.releaseTag,
  title: frozen.releaseTitle,
  notes: frozen.releaseNotes,
  draft: false,
  prerelease: false,
  assets: frozen.releaseAssets.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
};

const absent = { kind: "absent" } as const;
const available = <T>(value: T) => ({ kind: "available", value }) as const;
const unavailable = { kind: "unverifiable", reason: "fixture unavailable" } as const;

class FakePublicationSurfaces implements PublicationSurfaces {
  readonly calls: string[] = [];

  constructor(
    private observation: PublicationObservation,
    private readonly options: Readonly<{
      smokeFails?: boolean;
      npmConflictsAfterPublish?: boolean;
      tagConflictsAfterCreate?: boolean;
    }> = {},
  ) {}

  async inspect(): Promise<PublicationObservation> {
    this.calls.push("inspect");
    return structuredClone(this.observation);
  }

  async publishNpm(
    _candidate: FrozenPublication,
    authority: "bootstrap" | "trusted",
  ): Promise<void> {
    this.calls.push(`publish:${authority}`);
    this.observation = {
      ...this.observation,
      package: { kind: "present" },
      npmVersion: available(
        this.options.npmConflictsAfterPublish === true
          ? { ...exactNpm, shasum: "f".repeat(40) }
          : exactNpm,
      ),
    };
  }

  async smokeInstalledPackage(): Promise<void> {
    this.calls.push("smoke");
    if (this.options.smokeFails === true) throw new Error("signature smoke failed");
  }

  async createTag(): Promise<void> {
    this.calls.push("tag");
    this.observation = {
      ...this.observation,
      tag: available(
        this.options.tagConflictsAfterCreate === true
          ? { ...exactTag, targetCommit: "f".repeat(40) }
          : exactTag,
      ),
    };
  }

  async createRelease(): Promise<void> {
    this.calls.push("release");
    this.observation = { ...this.observation, release: available(exactRelease) };
  }
}

const state = (
  npmVersion: PublicationObservation["npmVersion"],
  tag: PublicationObservation["tag"],
  release: PublicationObservation["release"],
  packageState: PublicationObservation["package"] = { kind: "present" },
): PublicationObservation => ({ package: packageState, npmVersion, tag, release });

test("recovers every accepted monotonic prefix without repeating exact mutations", async () => {
  const scenarios: readonly Readonly<{
    initial: PublicationObservation;
    mutations: readonly string[];
    bootstrapToken?: string;
  }>[] = [
    {
      initial: state(absent, absent, absent, { kind: "absent" }),
      mutations: ["publish:bootstrap", "tag", "release"],
      bootstrapToken: "fixture-bootstrap",
    },
    { initial: state(absent, absent, absent), mutations: ["publish:trusted", "tag", "release"] },
    { initial: state(available(exactNpm), absent, absent), mutations: ["tag", "release"] },
    { initial: state(available(exactNpm), available(exactTag), absent), mutations: ["release"] },
    {
      initial: state(available(exactNpm), available(exactTag), available(exactRelease)),
      mutations: [],
    },
  ];

  for (const scenario of scenarios) {
    const surfaces = new FakePublicationSurfaces(scenario.initial);
    if (scenario.bootstrapToken !== undefined) {
      await bootstrapFrozenPackage(frozen, surfaces);
    }
    await expect(recoverFrozenPublication(frozen, surfaces)).resolves.toEqual({
      state: "published",
    });
    expect(surfaces.calls.filter((call) => call !== "inspect" && call !== "smoke")).toEqual([
      ...scenario.mutations,
    ]);
    expect(surfaces.calls).toContain("smoke");
    for (const mutation of scenario.mutations) {
      const mutationIndex = surfaces.calls.indexOf(mutation);
      expect(mutationIndex).toBeGreaterThan(0);
      expect(surfaces.calls[mutationIndex - 1]).toBe("inspect");
    }
  }
});

test("fails before mutation for conflicting, out-of-order, or unverifiable external state", async () => {
  const conflictNpm = available({ ...exactNpm, integrity: "sha512-conflict" });
  const wrongNpmIdentity = available({ ...exactNpm, name: "@lagrangee/different" });
  const wrongNpmShasum = available({ ...exactNpm, shasum: "e".repeat(40) });
  const wrongPredicate = available({
    ...exactNpm,
    provenancePredicateType: "https://slsa.dev/provenance/v0.2",
  });
  const {
    provenancePredicateType: _predicate,
    provenanceUrl: _url,
    ...withoutProvenance
  } = exactNpm;
  const missingProvenance = available(withoutProvenance);
  const mismatchedLatest = available({ ...exactNpm, latest: "0.0.9" });
  const conflictTag = available({ ...exactTag, targetCommit: "c".repeat(40) });
  const conflictRelease = available({ ...exactRelease, notes: "different notes\n" });
  const wrongReleaseTag = available({ ...exactRelease, tag: "v0.2.0" });
  const wrongReleaseTitle = available({ ...exactRelease, title: "Different title" });
  const draftRelease = available({ ...exactRelease, draft: true });
  const prerelease = available({ ...exactRelease, prerelease: true });
  const scenarios = [
    state(conflictNpm, absent, absent),
    state(wrongNpmIdentity, absent, absent),
    state(wrongNpmShasum, absent, absent),
    state(missingProvenance, absent, absent),
    state(wrongPredicate, absent, absent),
    state(mismatchedLatest, absent, absent),
    state(available(exactNpm), conflictTag, absent),
    state(available(exactNpm), available(exactTag), conflictRelease),
    state(available(exactNpm), available(exactTag), wrongReleaseTag),
    state(available(exactNpm), available(exactTag), wrongReleaseTitle),
    state(available(exactNpm), available(exactTag), draftRelease),
    state(available(exactNpm), available(exactTag), prerelease),
    state(absent, available(exactTag), absent),
    state(available(exactNpm), absent, available(exactRelease)),
    state(unavailable, absent, absent),
    state(absent, unavailable, absent),
    state(absent, absent, unavailable),
    state(absent, absent, absent, unavailable),
  ];

  for (const initial of scenarios) {
    const surfaces = new FakePublicationSurfaces(initial);
    await expect(recoverFrozenPublication(frozen, surfaces)).rejects.toThrow();
    expect(surfaces.calls).toEqual(["inspect"]);
  }
});

test("bootstrap authority is accepted only while the package itself is absent", async () => {
  const missing = new FakePublicationSurfaces(state(absent, absent, absent, { kind: "absent" }));
  await expect(recoverFrozenPublication(frozen, missing)).rejects.toThrow(
    "bootstrap step is required",
  );
  expect(missing.calls).toEqual(["inspect"]);

  const existing = new FakePublicationSurfaces(state(absent, absent, absent));
  await expect(bootstrapFrozenPackage(frozen, existing)).rejects.toThrow("package is not absent");
  expect(existing.calls).toEqual(["inspect"]);
});

test("signature smoke failure stops before tag or GitHub Release mutation", async () => {
  const surfaces = new FakePublicationSurfaces(state(available(exactNpm), absent, absent), {
    smokeFails: true,
  });
  await expect(recoverFrozenPublication(frozen, surfaces)).rejects.toThrow(
    "signature smoke failed",
  );
  expect(surfaces.calls).toContain("smoke");
  expect(surfaces.calls).not.toContain("tag");
  expect(surfaces.calls).not.toContain("release");
});

test("a failed mutation postcondition stops every later public mutation", async () => {
  const npmConflict = new FakePublicationSurfaces(state(absent, absent, absent), {
    npmConflictsAfterPublish: true,
  });
  await expect(recoverFrozenPublication(frozen, npmConflict)).rejects.toThrow(
    "npm version conflicts",
  );
  expect(npmConflict.calls).toContain("publish:trusted");
  expect(npmConflict.calls).not.toContain("tag");
  expect(npmConflict.calls).not.toContain("release");

  const tagConflict = new FakePublicationSurfaces(state(available(exactNpm), absent, absent), {
    tagConflictsAfterCreate: true,
  });
  await expect(recoverFrozenPublication(frozen, tagConflict)).rejects.toThrow("Git tag conflicts");
  expect(tagConflict.calls).toContain("tag");
  expect(tagConflict.calls).not.toContain("release");
});

test("GitHub Release identity includes all frozen Candidate assets", async () => {
  const incompleteRelease = available({ ...exactRelease, assets: exactRelease.assets.slice(0, 3) });
  const surfaces = new FakePublicationSurfaces(
    state(available(exactNpm), available(exactTag), incompleteRelease),
  );
  await expect(recoverFrozenPublication(frozen, surfaces)).rejects.toThrow(
    "GitHub Release conflicts",
  );
  expect(surfaces.calls).toEqual(["inspect"]);
});

test("repeated exact invocation reuses all public identities without mutation", async () => {
  const surfaces = new FakePublicationSurfaces(
    state(available(exactNpm), available(exactTag), available(exactRelease)),
  );
  await recoverFrozenPublication(frozen, surfaces);
  const firstMutationCalls = surfaces.calls.filter(
    (call) => call.startsWith("publish:") || call === "tag" || call === "release",
  );
  await recoverFrozenPublication(frozen, surfaces);
  const repeatedMutationCalls = surfaces.calls.filter(
    (call) => call.startsWith("publish:") || call === "tag" || call === "release",
  );
  expect(firstMutationCalls).toEqual([]);
  expect(repeatedMutationCalls).toEqual([]);
  expect(surfaces.calls.filter((call) => call === "smoke")).toHaveLength(2);
});

test("Publication workflow is manual, main-owned, protected, serialized, and frozen-byte only", async () => {
  const workflow = parseYaml(await readFile(".github/workflows/publish-preview.yml", "utf8")) as {
    readonly name: string;
    readonly on: Readonly<{
      workflow_dispatch: Readonly<{
        inputs: Readonly<Record<string, Readonly<{ required: boolean; type: string }>>>;
      }>;
    }>;
    readonly permissions: Readonly<Record<string, string>>;
    readonly concurrency: Readonly<{ group: string; "cancel-in-progress": boolean }>;
    readonly jobs: Readonly<
      Record<
        string,
        Readonly<{
          if: string;
          environment: string;
          "timeout-minutes": number;
          steps: readonly Readonly<{
            name?: string;
            uses?: string;
            run?: string;
            env?: Readonly<Record<string, string>>;
            with?: Readonly<Record<string, string | boolean>>;
          }>[];
        }>
      >
    >;
  };

  expect(workflow.name).toBe("Publish frozen release");
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.on.workflow_dispatch.inputs).toMatchObject({
    version: { required: true, type: "string" },
    source_commit: { required: true, type: "string" },
    candidate_run_id: { required: true, type: "string" },
    frozen_sha256: { required: true, type: "string" },
  });
  expect(workflow.permissions).toEqual({ actions: "read", contents: "write", "id-token": "write" });
  const concurrencyGroups = ["0.1.1", "0.1.2"].map((version) =>
    workflow.concurrency.group.replace(["$", "{{ inputs.version }}"].join(""), version),
  );
  expect(concurrencyGroups).toEqual([
    "publication-@lagrangee/bearing",
    "publication-@lagrangee/bearing",
  ]);
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);

  const job = workflow.jobs["publish"];
  expect(job?.if).toBe(["$", "{{ inputs.confirm == 'publish @lagrangee/bearing' }}"].join(""));
  expect(job?.environment).toBe("npm-publish");
  expect(job?.["timeout-minutes"]).toBeGreaterThan(0);
  expect(job?.["timeout-minutes"]).toBeLessThanOrEqual(30);
  const steps = job?.steps ?? [];
  const proofIndex = steps.findIndex(
    (step) => step.name === "Verify exact successful Candidate Freeze run",
  );
  const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
  const downloadIndex = steps.findIndex((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  const bootstrapIndex = steps.findIndex(
    (step) => step.name === "Bootstrap only the absent npm package",
  );
  const publicationIndex = steps.findIndex(
    (step) => step.name === "Verify frozen bundle and recover exact publication",
  );
  expect(proofIndex).toBe(0);
  const proof = steps[proofIndex]?.run ?? "";
  expect(proof).toContain('test "$GITHUB_REF" = "refs/heads/main"');
  expect(proof).toContain("repos/$GITHUB_REPOSITORY/actions/runs/$EXPECTED_RUN_ID");
  expect(proof).toContain(".github/workflows/package.yml");
  expect(proof).toContain('test "$ACTUAL_EVENT" = "workflow_dispatch"');
  expect(proof).toContain('test "$ACTUAL_STATUS" = "completed"');
  expect(proof).toContain('test "$ACTUAL_CONCLUSION" = "success"');
  expect(proof).toContain('test "$ACTUAL_BRANCH" = "main"');
  expect(proof).toContain("compare/$EXPECTED_COMMIT...$GITHUB_SHA");
  expect(proof).toContain("compare/$EXPECTED_COMMIT...$ACTUAL_COMMIT");
  expect(proof).toContain("https://registry.npmjs.org/@lagrangee%2fbearing");
  expect(proof).toContain("package_state=%s");
  expect(proof).not.toMatch(/scripts\/|npm (?:audit|ci|install|pack|publish)\b|bun |node /u);
  expect(checkoutIndex).toBeGreaterThan(proofIndex);
  expect(steps[checkoutIndex]?.with).toMatchObject({
    ref: ["$", "{{ github.sha }}"].join(""),
    "persist-credentials": false,
  });
  expect(downloadIndex).toBeGreaterThan(checkoutIndex);
  expect(steps[downloadIndex]?.with).toMatchObject({
    name: ["bearing-candidate-$", "{{ inputs.source_commit }}"].join(""),
    path: "release-candidate",
    "run-id": ["$", "{{ inputs.candidate_run_id }}"].join(""),
    "github-token": ["$", "{{ github.token }}"].join(""),
  });
  expect(bootstrapIndex).toBeGreaterThan(downloadIndex);
  expect(bootstrapIndex).toBeLessThan(publicationIndex);
  expect(steps[bootstrapIndex]).toMatchObject({
    if: ["$", "{{ steps.candidate_run.outputs.package_state == 'absent' }}"].join(""),
    env: {
      NPM_BOOTSTRAP_TOKEN: ["$", "{{ secrets.NPM_BOOTSTRAP_TOKEN }}"].join(""),
    },
  });
  expect(steps[bootstrapIndex]?.run).toContain("--bootstrap-absent-package");
  expect(publicationIndex).toBeGreaterThan(downloadIndex);
  expect(steps[publicationIndex]?.run).toContain("scripts/publish-release-candidate.ts");
  expect(steps[publicationIndex]?.run).toContain(
    "--receipt release-candidate/candidate-receipt.json",
  );
  expect(steps[publicationIndex]?.run).toContain('--frozen-sha256 "$EXPECTED_FROZEN_SHA256"');
  expect(steps[publicationIndex]?.env?.["NPM_BOOTSTRAP_TOKEN"]).toBeUndefined();
  expect(steps[publicationIndex]?.run).not.toContain("--bootstrap-absent-package");

  const surface = JSON.stringify(workflow);
  expect(surface).not.toMatch(/prepare-preview-release|npm pack\b|release notes.*CHANGELOG/iu);
  for (const action of steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]))) {
    expect(action).toMatch(/@[0-9a-f]{40}$/u);
  }
});

import { createHash } from "node:crypto";
import { cp, lstat, readdir, readFile, readlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

const fail = (message: string): never => {
  throw new Error(message);
};

export const liveScenarioIdSchema = z.string().regex(/^[a-z]+(?:-[a-z]+)*$/u);
const boundedTextSchema = z.string().trim().min(1).max(800);
const fixtureLocatorSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes("..") && value !== ".",
    "Fixture locators must stay bounded and relative.",
  );

export const liveScenarioFixtureProfileSchema = z.enum([
  "fresh-installation-repository",
  "active-repository",
  "fresh-repository",
  "active-repository-with-drift",
  "repository-update-required-repository",
  "active-planning-repository",
  "active-planned-unbound-native-repository",
  "active-unbound-native-repository",
  "active-bound-wayfinder-repository",
  "active-bound-local-repository",
  "active-github-repository",
]);

export const liveScenarioSkillNameSchema = z.enum([
  "bearing",
  "wayfinder",
  "grilling",
  "domain-modeling",
  "implement",
  "tdd",
  "code-review",
]);

export const liveScenarioSkillRoleSchema = z.enum([
  "prerequisite",
  "installation-under-test",
  "intentionally-absent",
]);

export const liveScenarioCapabilityProfileSchema = z.enum(["github-bounded-delivery"]);
export type LiveScenarioCapabilityProfile = z.infer<typeof liveScenarioCapabilityProfileSchema>;

export const liveScenarioResourceKeyForCapability = (
  capabilityProfile: LiveScenarioCapabilityProfile | undefined,
): "github-validation-repository" | undefined =>
  capabilityProfile === "github-bounded-delivery" ? "github-validation-repository" : undefined;

const fixedValidationFixtureSchema = z
  .object({
    source: z.string().min(1),
    profile: liveScenarioFixtureProfileSchema,
    skills: z
      .array(
        z
          .object({
            skill: liveScenarioSkillNameSchema,
            role: liveScenarioSkillRoleSchema,
          })
          .strict(),
      )
      .min(1)
      .max(liveScenarioSkillNameSchema.options.length),
    capabilityProfile: liveScenarioCapabilityProfileSchema.optional(),
    assertions: z
      .array(
        z
          .object({
            path: fixtureLocatorSchema,
            contains: boundedTextSchema,
          })
          .strict(),
      )
      .max(24)
      .optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    const skillNames = fixture.skills.map(({ skill }) => skill);
    if (new Set(skillNames).size !== skillNames.length) {
      context.addIssue({
        code: "custom",
        path: ["skills"],
        message: "Each Matrix Skill must declare exactly one role.",
      });
    }
  });

export const liveScenarioTerminalObserverSchema = z.enum([
  "repository",
  "agent-home",
  "git",
  "github",
]);

const terminalEvidenceSchema = z
  .object({
    description: boundedTextSchema,
    observers: z.array(liveScenarioTerminalObserverSchema).min(1).max(4),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (new Set(evidence.observers).size !== evidence.observers.length) {
      context.addIssue({
        code: "custom",
        path: ["observers"],
        message: "Terminal Evidence observers must be unique.",
      });
    }
  });

export const liveScenarioSchema = z
  .object({
    id: liveScenarioIdSchema,
    fixedValidationFixture: fixedValidationFixtureSchema,
    initialPrompt: z.string().trim().min(1),
    humanPosition: boundedTextSchema,
    bearingIntent: boundedTextSchema,
    terminalEvidence: terminalEvidenceSchema,
  })
  .strict();

const liveScenarioRegistrySchema = z
  .object({
    schemaVersion: z.literal(2),
    scenarios: z.array(liveScenarioSchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = registry.scenarios.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Live Scenario IDs must be unique." });
    }
    for (const [index, scenario] of registry.scenarios.entries()) {
      const fixture = scenario.fixedValidationFixture;
      const bearingRole = fixture.skills.find(({ skill }) => skill === "bearing")?.role;
      const installationUnderTest = fixture.skills.filter(
        ({ role }) => role === "installation-under-test",
      );
      if (
        fixture.profile === "fresh-installation-repository"
          ? bearingRole !== "installation-under-test" || installationUnderTest.length !== 1
          : bearingRole !== "prerequisite" || installationUnderTest.length !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", index, "fixedValidationFixture", "skills"],
          message:
            "The Fixture Profile requires one coherent Bearing prerequisite or installation-under-test role.",
        });
      }
      const expectedCapability =
        fixture.profile === "active-github-repository" ? "github-bounded-delivery" : undefined;
      if (fixture.capabilityProfile !== expectedCapability) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", index, "fixedValidationFixture", "capabilityProfile"],
          message: "The Capability Profile contradicts the selected Fixture Profile.",
        });
      }
      const observesGitHub = scenario.terminalEvidence.observers.includes("github");
      if (observesGitHub !== (fixture.profile === "active-github-repository")) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", index, "terminalEvidence", "observers"],
          message: "GitHub Terminal Evidence must belong only to the GitHub Fixture.",
        });
      }
    }
  });

export type LiveScenario = z.infer<typeof liveScenarioSchema>;
export type LiveScenarioRegistry = z.infer<typeof liveScenarioRegistrySchema>;

export const parseLiveScenarioRegistry = (input: unknown): LiveScenarioRegistry =>
  liveScenarioRegistrySchema.parse(input);

export const loadLiveScenarioRegistry = async (path: string): Promise<LiveScenarioRegistry> =>
  parseLiveScenarioRegistry(JSON.parse(await readFile(path, "utf8")));

export const preflightLiveScenarioRegistry = async (input: {
  sourceRoot: string;
  registryPath: string;
}) => {
  const sourceRoot = resolve(input.sourceRoot);
  const registryPath = resolve(sourceRoot, input.registryPath);
  const registryRelative = relative(sourceRoot, registryPath);
  if (registryRelative.startsWith("..") || isAbsolute(registryRelative)) {
    fail("Live Scenario registry must stay inside the source checkout.");
  }
  const registry = await loadLiveScenarioRegistry(registryPath);
  const fixtureAssertionsVerified: Array<{ scenarioId: string; count: number }> = [];
  for (const scenario of registry.scenarios) {
    const fixture = scenario.fixedValidationFixture;
    const fixtureRoot = resolve(sourceRoot, fixture.source);
    const fixtureRelative = relative(sourceRoot, fixtureRoot);
    if (fixtureRelative.startsWith("..") || isAbsolute(fixtureRelative)) {
      fail(`Live Scenario fixture escapes the source checkout: ${scenario.id}.`);
    }
    const fixtureState = await lstat(fixtureRoot);
    if (!fixtureState.isDirectory()) {
      fail(`Live Scenario fixture must be a directory: ${scenario.id}.`);
    }
    await digestLiveScenarioFixture(fixtureRoot);
    const assertions = fixture.assertions ?? [];
    for (const assertion of assertions) {
      const path = resolve(fixtureRoot, assertion.path);
      const relation = relative(fixtureRoot, path);
      if (relation.startsWith("..") || isAbsolute(relation)) {
        fail(`Live Scenario fixture assertion escapes its Fixture: ${scenario.id}.`);
      }
      const bytes = await readFile(path, "utf8");
      if (!bytes.includes(assertion.contains)) {
        fail(
          `Live Scenario fixture assertion is false: ${scenario.id} ${assertion.path} does not contain the required starting text.`,
        );
      }
    }
    if (assertions.length > 0) {
      fixtureAssertionsVerified.push({ scenarioId: scenario.id, count: assertions.length });
    }
  }
  return Object.freeze({
    scenarioCount: registry.scenarios.length,
    fixtureAssertionsVerified: Object.freeze(fixtureAssertionsVerified),
    semanticReviewRequired: true as const,
    semanticReviewScenarioIds: Object.freeze(registry.scenarios.map(({ id }) => id)),
  });
};

type SnapshotEntry = Readonly<{ locator: string; kind: "file" | "symbolic-link" }>;

const snapshotEntries = async (
  root: string,
  directory: string,
): Promise<readonly SnapshotEntry[]> => {
  const entries: SnapshotEntry[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(directory, entry.name);
    const locator = relative(root, path);
    if (entry.isDirectory()) entries.push(...(await snapshotEntries(root, path)));
    else if (entry.isFile()) entries.push({ locator, kind: "file" });
    else if (entry.isSymbolicLink()) entries.push({ locator, kind: "symbolic-link" });
    else fail(`Live Scenario fixtures refuse non-file entries: ${locator}`);
  }
  return entries.sort((left, right) => left.locator.localeCompare(right.locator, "en"));
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

export const digestLiveScenarioFixture = async (root: string): Promise<string> => {
  const frames: string[] = [];
  for (const entry of await snapshotEntries(root, root)) {
    const bytes =
      entry.kind === "file"
        ? await readFile(join(root, entry.locator))
        : Buffer.from(await readlink(join(root, entry.locator)), "utf8");
    frames.push(`${entry.kind}\0${entry.locator}\0${sha256(bytes)}\n`);
  }
  return sha256(frames.join(""));
};

export const liveScenarioReferencedFixtureSources = (
  registryInput: LiveScenarioRegistry,
  scenarioIds?: readonly string[],
): readonly string[] => {
  const registry = liveScenarioRegistrySchema.parse(registryInput);
  const selectedIds =
    scenarioIds === undefined
      ? undefined
      : z
          .array(liveScenarioIdSchema)
          .min(1)
          .parse([...scenarioIds]);
  if (selectedIds !== undefined && new Set(selectedIds).size !== selectedIds.length) {
    fail("Selected Live Scenario IDs must be unique.");
  }
  const selected = selectedIds === undefined ? undefined : new Set(selectedIds);
  if (
    selected !== undefined &&
    registry.scenarios.filter(({ id }) => selected.has(id)).length !== selected.size
  ) {
    fail("Selected Live Scenario IDs must exist in the registry.");
  }
  return Object.freeze(
    [
      ...new Set(
        registry.scenarios
          .filter(({ id }) => selected === undefined || selected.has(id))
          .map(({ fixedValidationFixture }) => fixedValidationFixture.source),
      ),
    ].sort((left, right) => left.localeCompare(right, "en")),
  );
};

export const digestLiveScenarioFixtureSet = async (input: {
  sourceRoot: string;
  registry: LiveScenarioRegistry;
  scenarioIds?: readonly string[];
}): Promise<string> => {
  const sourceRoot = resolve(input.sourceRoot);
  const frames: string[] = [];
  for (const source of liveScenarioReferencedFixtureSources(input.registry, input.scenarioIds)) {
    const fixtureRoot = resolve(sourceRoot, source);
    const fixtureRelative = relative(sourceRoot, fixtureRoot);
    if (fixtureRelative.startsWith("..") || isAbsolute(fixtureRelative)) {
      fail(`Live Scenario fixture escapes the source checkout: ${source}.`);
    }
    const state = await lstat(fixtureRoot);
    if (!state.isDirectory()) {
      fail(`Live Scenario fixture must be a directory: ${source}.`);
    }
    frames.push(`fixture\0${fixtureRelative}\0${await digestLiveScenarioFixture(fixtureRoot)}\n`);
  }
  return sha256(frames.join(""));
};

export const materializeLiveScenarioFixture = async (input: {
  registry: LiveScenarioRegistry;
  scenarioId: string;
  sourceRoot: string;
  outputRoot: string;
}) => {
  const registry = liveScenarioRegistrySchema.parse(input.registry);
  const scenarioId = liveScenarioIdSchema.parse(input.scenarioId);
  const scenario =
    registry.scenarios.find(({ id }) => id === scenarioId) ??
    fail(`Unknown Live Scenario: ${scenarioId}.`);
  const sourceRoot = resolve(input.sourceRoot);
  const outputRoot = resolve(input.outputRoot);
  if (!isAbsolute(input.sourceRoot) || !isAbsolute(input.outputRoot) || sourceRoot === outputRoot) {
    fail("Live Scenario fixture paths must be distinct absolute paths.");
  }
  try {
    await lstat(outputRoot);
    fail(`Live Scenario fixture output already exists: ${outputRoot}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const fixtureSource = resolve(sourceRoot, scenario.fixedValidationFixture.source);
  const fixtureRelative = relative(sourceRoot, fixtureSource);
  if (fixtureRelative.startsWith("..") || isAbsolute(fixtureRelative)) {
    fail("Live Scenario fixture source must stay inside the source checkout.");
  }
  await cp(fixtureSource, outputRoot, { recursive: true, errorOnExist: true, force: false });
  return Object.freeze({
    scenarioId,
    fixtureProfile: scenario.fixedValidationFixture.profile,
    fixtureRoot: outputRoot,
    startingStateSha256: await digestLiveScenarioFixture(outputRoot),
  });
};

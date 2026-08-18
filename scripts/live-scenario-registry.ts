import { createHash } from "node:crypto";
import { cp, lstat, readdir, readFile, readlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

const fail = (message: string): never => {
  throw new Error(message);
};

const scenarioIdSchema = z.string().regex(/^[A-Z]+-\d{2}$/u);
const boundedTextSchema = z.string().trim().min(1).max(800);
const fixtureLocatorSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes("..") && value !== ".",
    "Fixture assertion locators must stay bounded and relative.",
  );
export const liveScenarioEvidencePointerSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.split(/[\\/]/u).includes("..") &&
      !value
        .split(/[\\/]/u)
        .some((segment) => /(?:transcript|session|operator-config)/iu.test(segment)),
    "Scenario evidence pointers must stay bounded and relative.",
  );

const fixtureSchema = z
  .object({
    source: z.string().min(1),
    materializer: z.enum([
      "fresh-repository",
      "installed-unconfigured-repository",
      "non-project-directory",
      "active-repository",
      "active-repository-with-drift",
      "deactivated-repository",
      "repository-update-required-repository",
      "kit-update-required-repository",
      "unsupported-repository",
      "active-planning-repository",
      "active-unbound-native-repository",
      "active-bound-local-repository",
      "active-github-repository",
      "active-ambiguous-native-repository",
      "active-failing-execution-repository",
    ]),
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
  .strict();

const liveScenarioSchema = z
  .object({
    id: scenarioIdSchema,
    name: z.string().trim().min(1),
    fixture: fixtureSchema,
    prompts: z.array(z.string().trim().min(1)).min(1),
    requiredOutcomes: z.array(boundedTextSchema).min(1),
    forbiddenOutcomes: z.array(boundedTextSchema).min(1),
  })
  .strict();

const liveScenarioRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarios: z.array(liveScenarioSchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = registry.scenarios.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Live Scenario IDs must be unique." });
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
    const fixtureRoot = resolve(sourceRoot, scenario.fixture.source);
    const fixtureRelative = relative(sourceRoot, fixtureRoot);
    if (fixtureRelative.startsWith("..") || isAbsolute(fixtureRelative)) {
      fail(`Live Scenario fixture escapes the source checkout: ${scenario.id}.`);
    }
    const fixtureState = await lstat(fixtureRoot);
    if (!fixtureState.isDirectory()) {
      fail(`Live Scenario fixture must be a directory: ${scenario.id}.`);
    }
    await digestLiveScenarioFixture(fixtureRoot);
    const assertions = scenario.fixture.assertions ?? [];
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

export const materializeLiveScenarioFixture = async (input: {
  registry: LiveScenarioRegistry;
  scenarioId: string;
  sourceRoot: string;
  outputRoot: string;
}) => {
  const registry = liveScenarioRegistrySchema.parse(input.registry);
  const scenarioId = scenarioIdSchema.parse(input.scenarioId);
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
  const fixtureSource = resolve(sourceRoot, scenario.fixture.source);
  const fixtureRelative = relative(sourceRoot, fixtureSource);
  if (fixtureRelative.startsWith("..") || isAbsolute(fixtureRelative)) {
    fail("Live Scenario fixture source must stay inside the source checkout.");
  }
  await cp(fixtureSource, outputRoot, { recursive: true, errorOnExist: true, force: false });
  return Object.freeze({
    scenarioId,
    materializer: scenario.fixture.materializer,
    fixtureRoot: outputRoot,
    startingStateSha256: await digestLiveScenarioFixture(outputRoot),
  });
};

const outcomeObservationSchema = z
  .object({
    requirement: boundedTextSchema,
    observed: z.boolean(),
    evidencePointers: z.array(liveScenarioEvidencePointerSchema).min(1).max(24),
  })
  .strict();

const liveScenarioEvaluationSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: scenarioIdSchema,
    outcome: z.enum(["pass", "fail", "blocked", "not-run"]),
    semanticEvaluationAuthority: z.literal("coordinating-agent"),
    coordinatorIdentity: z.string().trim().min(1).max(200),
    rationale: boundedTextSchema,
    requiredOutcomeObservations: z.array(outcomeObservationSchema).min(1),
    forbiddenOutcomeObservations: z.array(outcomeObservationSchema).min(1),
  })
  .strict();

export type LiveScenarioEvaluation = z.infer<typeof liveScenarioEvaluationSchema>;

export const parseLiveScenarioEvaluation = (input: unknown): LiveScenarioEvaluation =>
  liveScenarioEvaluationSchema.parse(input);

const exactObservations = (
  label: string,
  requirements: readonly string[],
  observations: readonly z.infer<typeof outcomeObservationSchema>[],
): void => {
  const expected = [...requirements].sort();
  const observed = observations.map(({ requirement }) => requirement).sort();
  if (
    expected.length !== observed.length ||
    new Set(observed).size !== observed.length ||
    expected.some((requirement, index) => requirement !== observed[index])
  ) {
    fail(`Scenario evaluation requires each ${label} exactly once.`);
  }
};

export const createLiveScenarioEvaluation = (input: {
  scenario: LiveScenario;
  outcome: "pass" | "fail" | "blocked" | "not-run";
  coordinatorIdentity: string;
  rationale: string;
  requiredOutcomeObservations: readonly unknown[];
  forbiddenOutcomeObservations: readonly unknown[];
}) => {
  const scenario = liveScenarioSchema.parse(input.scenario);
  const outcome = z.enum(["pass", "fail", "blocked", "not-run"]).parse(input.outcome);
  const coordinatorIdentity = z.string().trim().min(1).max(200).parse(input.coordinatorIdentity);
  const rationale = boundedTextSchema.parse(input.rationale);
  const requiredOutcomeObservations = z
    .array(outcomeObservationSchema)
    .parse(input.requiredOutcomeObservations);
  const forbiddenOutcomeObservations = z
    .array(outcomeObservationSchema)
    .parse(input.forbiddenOutcomeObservations);
  exactObservations("required outcome", scenario.requiredOutcomes, requiredOutcomeObservations);
  exactObservations("forbidden outcome", scenario.forbiddenOutcomes, forbiddenOutcomeObservations);
  if (
    outcome === "pass" &&
    (requiredOutcomeObservations.some(({ observed }) => !observed) ||
      forbiddenOutcomeObservations.some(({ observed }) => observed))
  ) {
    fail("Scenario pass contradicts its hard observable outcomes.");
  }
  return Object.freeze(
    liveScenarioEvaluationSchema.parse({
      schemaVersion: 1 as const,
      scenarioId: scenario.id,
      outcome,
      semanticEvaluationAuthority: "coordinating-agent" as const,
      coordinatorIdentity,
      rationale,
      requiredOutcomeObservations: Object.freeze(
        requiredOutcomeObservations.map((observation) => Object.freeze(observation)),
      ),
      forbiddenOutcomeObservations: Object.freeze(
        forbiddenOutcomeObservations.map((observation) => Object.freeze(observation)),
      ),
    }),
  );
};

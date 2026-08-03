import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import packageMetadata from "../package.json";
import {
  AGENT_SURFACES,
  agentSurfaceEntryFile,
  bearingManagedRange,
  withBearingManagedPointer,
  withoutBearingManagedPointer,
} from "./agent-surface-entry";
import {
  assertExecutorRegistrationsCurrent,
  renderExecutionProfile,
  validateExecutorRegistrationSelection,
} from "./executor-registration";
import { parseFrontmatter } from "./frontmatter";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans, type InstallTargetWriter, preflightInstallTargets } from "./installer";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import { displaySourceLocatorSchema } from "./reference-schema";
import {
  assertMattProviderContractCurrent,
  assertRepositoryTargetPreconditionsCurrent,
  captureRepositoryTargetPreconditions,
  inspectMattProviderContract,
} from "./repository-integration-plan";
import { bearingSchema, manifestSchema } from "./schema-definitions";
import { prepareSync } from "./sync-plan";
import { buildSyncTransactionTargets } from "./sync-transaction";
import type { RepositorySetupOptions, RepositorySetupResult } from "./types";

const SOURCE_SCHEMA = "bearing-repository/v0.1.0";
const TARGET_SCHEMA = "bearing-repository/v0.1.1";
const legacyManifestSchema = manifestSchema.refine((manifest) => manifest.status === undefined);
const packageSchema = z.object({ version: z.string().min(1) });
const effortRecordSchema = z
  .object({
    Type: z.literal("effort"),
    ID: z.string().regex(/^effort:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    Roadmap: z.string().regex(/^roadmap:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    "Target gate": z.string().regex(/^gate:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .passthrough();
const recoveryInventorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("bearing-recovery-bundle"),
    createdAt: z.string().datetime(),
    sourceSchema: z.literal(SOURCE_SCHEMA),
    targetSchema: z.literal(TARGET_SCHEMA),
    entries: z
      .array(
        z.strictObject({
          source: z.string().min(1),
          bundlePath: displaySourceLocatorSchema,
          sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
          bytes: z.number().int().nonnegative(),
          disposition: z.enum(["preserve", "transform", "remove", "replace"]),
          filePrecondition: z
            .strictObject({
              sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
              bytes: z.number().int().nonnegative(),
              mode: z.number().int().min(0).max(0o777),
            })
            .optional(),
        }),
      )
      .min(1),
  })
  .superRefine((inventory, context) => {
    const sources = new Set<string>();
    const bundlePaths = new Set<string>();
    inventory.entries.forEach((entry, index) => {
      if (sources.has(entry.source)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "source"],
          message: "Recovery Bundle sources must be unique.",
        });
      }
      if (bundlePaths.has(entry.bundlePath)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "bundlePath"],
          message: "Recovery Bundle payload paths must be unique.",
        });
      }
      sources.add(entry.source);
      bundlePaths.add(entry.bundlePath);
      const managedBlock = entry.source.endsWith("#bearing-managed-block");
      if (managedBlock === (entry.filePrecondition !== undefined)) return;
      context.addIssue({
        code: "custom",
        path: ["entries", index, "filePrecondition"],
        message: managedBlock
          ? "Managed Agent Surface entries require their containing file precondition."
          : "Only managed Agent Surface entries may carry a containing file precondition.",
      });
    });
  });

const assertLegacySourceSyncClean = async (
  root: string,
  effortLocators: readonly string[],
): Promise<void> => {
  const legacyEffortIds = new Set(
    await Promise.all(
      effortLocators.map(async (locator) => {
        const parsed = parseFrontmatter(
          (await readContainedFile(root, join(root, locator))).toString("utf8"),
        );
        if (!parsed.ok) throw new Error(`Legacy Effort has invalid frontmatter: ${locator}`);
        return effortRecordSchema.parse(parsed.data).ID;
      }),
    ),
  );
  const sourceSync = await prepareSync(root, {
    explicitInputs: effortLocators,
    providerObservationIntent: "initial-baseline",
  });
  const declaredIds = new Set(
    sourceSync.decoded.records.flatMap((record) =>
      record.diagnostics.some((diagnostic) => diagnostic.impact === "blocking")
        ? []
        : record.analysis.nodes.map((node) => node.id),
    ),
  );
  const expectedLegacyReferenceSources = new Set(
    sourceSync.decoded.records.flatMap((record) => {
      const unresolved = record.analysis.references.filter(
        (reference) => !declaredIds.has(reference.target),
      );
      return unresolved.length > 0 &&
        unresolved.every((reference) => legacyEffortIds.has(reference.target))
        ? [record.locator]
        : [];
    }),
  );
  const legacyEffortLocatorSet = new Set(effortLocators);
  const diagnostics = sourceSync.diagnostics.filter(
    (diagnostic) =>
      !(
        diagnostic.code === "invalid-bearing-manifest" &&
        diagnostic.target === ".bearing/manifest.json"
      ) &&
      !(
        diagnostic.code === "missing-provider-configuration" &&
        diagnostic.target === ".bearing/provider.json"
      ) &&
      !(
        diagnostic.code === "effort-work-binding-missing" &&
        legacyEffortLocatorSet.has(diagnostic.target)
      ) &&
      !(
        diagnostic.code === "broken-canonical-reference" &&
        expectedLegacyReferenceSources.has(diagnostic.target)
      ),
  );
  if (diagnostics.length > 0) {
    throw new Error(
      `Legacy source cannot be cut over safely; resolve diagnostics first: ${diagnostics
        .map((diagnostic) => `${diagnostic.code}(${diagnostic.target})`)
        .join(", ")}.`,
    );
  }
};
const recoveryReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("bearing-recovery-bundle-receipt"),
  createdAt: z.string().datetime(),
  sourceSchema: z.literal(SOURCE_SCHEMA),
  targetSchema: z.literal(TARGET_SCHEMA),
  inventoryHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  entryCount: z.number().int().nonnegative(),
  verified: z.literal(true),
});

type RecoveryEntry = z.infer<typeof recoveryInventorySchema>["entries"][number] & {
  readonly bytesValue: Buffer;
};

const hash = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const readOptionalContained = async (root: string, target: string): Promise<Buffer | undefined> => {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const locator = relative(root, target).split(sep).join("/");
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Optional cutover source must be one safe single-link file: ${locator}`);
  }
  return readContainedFile(root, target);
};

const safeFiles = async (root: string, locator: string): Promise<readonly string[]> => {
  const target = join(root, locator);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Cutover found an unsafe symbolic link: ${locator}`);
  }
  if (metadata.isFile()) {
    if (metadata.nlink !== 1) throw new Error(`Cutover found an unsafe hard link: ${locator}`);
    return [locator];
  }
  if (!metadata.isDirectory()) throw new Error(`Cutover found an unsupported target: ${locator}`);
  const entries = await readdir(target, { withFileTypes: true });
  const nested: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const child = posix.join(locator, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Cutover found an unsafe symbolic link: ${child}`);
    if (entry.isFile()) {
      const childMetadata = await lstat(join(root, child));
      if (childMetadata.nlink !== 1) throw new Error(`Cutover found an unsafe hard link: ${child}`);
      nested.push(child);
      continue;
    }
    if (entry.isDirectory()) {
      nested.push(...(await safeFiles(root, child)));
      continue;
    }
    throw new Error(`Cutover found an unsupported target: ${child}`);
  }
  return nested;
};

const legacyEffortLocators = async (root: string): Promise<readonly string[]> => {
  const scratch = join(root, ".scratch");
  try {
    const metadata = await lstat(scratch);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Legacy Effort discovery requires a safe .scratch directory.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const entries = await readdir(scratch, { withFileTypes: true });
  const locators: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error(
        `Legacy Effort discovery found an unsafe symbolic link: .scratch/${entry.name}`,
      );
    if (!entry.isDirectory()) continue;
    const locator = posix.join(".scratch", entry.name, "effort.md");
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(join(root, locator));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error(`Legacy Effort must be one safe single-link regular file: ${locator}`);
    }
    locators.push(locator);
  }
  return locators.sort((left, right) => left.localeCompare(right, "en"));
};

const managedBlockEntry = async (
  root: string,
  surface: (typeof AGENT_SURFACES)[number],
): Promise<RecoveryEntry | undefined> => {
  const locator = agentSurfaceEntryFile(surface);
  const target = join(root, locator);
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`Managed Agent Surface must be one safe single-link file: ${locator}`);
  }
  const bytes = await readContainedFile(root, target);
  const after = await lstat(target);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1
  ) {
    throw new Error(`Managed Agent Surface changed while it was inspected: ${locator}`);
  }
  const source = bytes.toString("utf8");
  const range = bearingManagedRange(source);
  if (range === undefined) return undefined;
  const block = Buffer.from(source.slice(range.start, range.end), "utf8");
  const bundlePath = posix.join("managed-blocks", locator);
  return {
    source: `${locator}#bearing-managed-block`,
    bundlePath,
    sha256: hash(block),
    bytes: block.length,
    disposition: "replace",
    filePrecondition: {
      sha256: hash(bytes),
      bytes: bytes.length,
      mode: after.mode & 0o777,
    },
    bytesValue: block,
  };
};

const recoveryEntry = async (
  root: string,
  source: string,
  disposition: RecoveryEntry["disposition"],
): Promise<RecoveryEntry> => {
  const bytes = await readContainedFile(root, join(root, source));
  return {
    source,
    bundlePath: posix.join("repository", source),
    sha256: hash(bytes),
    bytes: bytes.length,
    disposition,
    bytesValue: bytes,
  };
};

const buildRecoveryEntries = async (
  root: string,
  effortLocators: readonly string[],
): Promise<readonly RecoveryEntry[]> => {
  const entries: RecoveryEntry[] = [];
  entries.push(await recoveryEntry(root, ".bearing/manifest.json", "replace"));
  for (const locator of await safeFiles(root, ".bearing/state")) {
    entries.push(await recoveryEntry(root, locator, "preserve"));
  }
  for (const locator of await safeFiles(root, ".bearing/executor-profiles")) {
    entries.push(await recoveryEntry(root, locator, "remove"));
  }
  const provider = await readOptionalContained(root, join(root, ".bearing/provider.json"));
  if (provider !== undefined)
    entries.push(await recoveryEntry(root, ".bearing/provider.json", "replace"));
  for (const locator of effortLocators) {
    entries.push(await recoveryEntry(root, locator, "transform"));
  }
  for (const surface of AGENT_SURFACES) {
    const entry = await managedBlockEntry(root, surface);
    if (entry !== undefined) entries.push(entry);
  }
  return entries.sort((left, right) => left.source.localeCompare(right.source, "en"));
};

const equalRecoveryGeneration = (
  createdAt: string,
  left: readonly RecoveryEntry[],
  right: readonly RecoveryEntry[],
): boolean => inventoryBytes(createdAt, left).equals(inventoryBytes(createdAt, right));

const cutoverTimestamp = (value: string | undefined): Readonly<{ iso: string; suffix: string }> => {
  if (value === undefined) {
    throw new Error(
      "Cutover requires --cutover-at with the timestamp shown in the inspected Apply review.",
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error("--cutover-at must be a canonical ISO-8601 UTC timestamp.");
  }
  return { iso: value, suffix: value.replaceAll(/[-:.]/gu, "").replace("Z", "Z") };
};

const inventoryBytes = (createdAt: string, entries: readonly RecoveryEntry[]): Buffer =>
  Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "bearing-recovery-bundle",
        createdAt,
        sourceSchema: SOURCE_SCHEMA,
        targetSchema: TARGET_SCHEMA,
        entries: entries.map(({ bytesValue: _bytesValue, ...entry }) => entry),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

export const verifyRecoveryBundle = async (
  root: string,
  bundleRoot: string,
  requireReceipt = true,
): Promise<Readonly<{ inventory: z.infer<typeof recoveryInventorySchema>; bytes: Buffer }>> => {
  const bundleRelative = relative(root, bundleRoot).split(sep).join("/");
  const bundleFiles = await safeFiles(root, bundleRelative);
  let inventoryBuffer: Buffer;
  try {
    inventoryBuffer = await readContainedFile(root, join(bundleRoot, "inventory.json"));
  } catch (error) {
    throw new Error("Recovery Bundle is incomplete: inventory.json is unavailable.", {
      cause: error,
    });
  }
  let inventory: z.infer<typeof recoveryInventorySchema>;
  try {
    inventory = recoveryInventorySchema.parse(JSON.parse(inventoryBuffer.toString("utf8")));
  } catch (error) {
    throw new Error("Recovery Bundle inventory is invalid.", { cause: error });
  }
  for (const entry of inventory.entries) {
    const bytes = await readContainedFile(root, join(bundleRoot, entry.bundlePath));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) {
      throw new Error(`Recovery Bundle payload failed verification: ${entry.source}`);
    }
  }
  const expectedFiles = new Set([
    posix.join(bundleRelative, "inventory.json"),
    ...(requireReceipt ? [posix.join(bundleRelative, "receipt.json")] : []),
    ...inventory.entries.map((entry) => posix.join(bundleRelative, entry.bundlePath)),
  ]);
  const missing = [...expectedFiles].filter((locator) => !bundleFiles.includes(locator));
  if (missing.length > 0) {
    throw new Error(`Recovery Bundle is incomplete: ${missing.join(", ")}`);
  }
  const unexpected = bundleFiles.filter((locator) => !expectedFiles.has(locator));
  if (unexpected.length > 0) {
    throw new Error(`Recovery Bundle contains unverified files: ${unexpected.join(", ")}`);
  }
  if (requireReceipt) {
    let receipt: z.infer<typeof recoveryReceiptSchema>;
    try {
      receipt = recoveryReceiptSchema.parse(
        JSON.parse(
          (await readContainedFile(root, join(bundleRoot, "receipt.json"))).toString("utf8"),
        ),
      );
    } catch (error) {
      throw new Error("Recovery Bundle receipt is invalid.", { cause: error });
    }
    if (
      receipt.createdAt !== inventory.createdAt ||
      receipt.inventoryHash !== hash(inventoryBuffer) ||
      receipt.entryCount !== inventory.entries.length
    ) {
      throw new Error("Recovery Bundle receipt does not match its verified inventory.");
    }
  }
  return { inventory, bytes: inventoryBuffer };
};

const createAndVerifyRecoveryBundle = async (
  root: string,
  bundleRoot: string,
  createdAt: string,
  entries: readonly RecoveryEntry[],
  writer?: InstallTargetWriter,
): Promise<void> => {
  let bundleState: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    bundleState = await lstat(bundleRoot);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (bundleState !== undefined) {
    if (!bundleState.isDirectory() || bundleState.isSymbolicLink()) {
      throw new Error("Recovery Bundle target is not one safe repository directory.");
    }
    const verified = await verifyRecoveryBundle(root, bundleRoot);
    const expectedInventory = inventoryBytes(createdAt, entries);
    if (!verified.bytes.equals(expectedInventory)) {
      throw new Error(
        "Recovery Bundle does not match the current inspected source generation and receipt.",
      );
    }
    return;
  }
  const inventory = inventoryBytes(createdAt, entries);
  const receipt = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "bearing-recovery-bundle-receipt",
        createdAt,
        sourceSchema: SOURCE_SCHEMA,
        targetSchema: TARGET_SCHEMA,
        inventoryHash: hash(inventory),
        entryCount: entries.length,
        verified: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const plans: TargetPlan[] = [
    {
      target: join(bundleRoot, "inventory.json"),
      bytes: inventory,
      executable: false,
    },
    ...entries.map(
      (entry): TargetPlan => ({
        target: join(bundleRoot, entry.bundlePath),
        bytes: entry.bytesValue,
        executable: false,
      }),
    ),
    { target: join(bundleRoot, "receipt.json"), bytes: receipt, executable: false },
  ];
  await applyInstallPlans(root, plans, writer, undefined, undefined, async () => {
    await verifyRecoveryBundle(root, bundleRoot);
  });
};

const assertRecoverySourcesCurrent = async (
  root: string,
  entries: readonly RecoveryEntry[],
): Promise<void> => {
  for (const entry of entries) {
    if (entry.source.endsWith("#bearing-managed-block")) {
      const surface = entry.source.slice(0, -"#bearing-managed-block".length);
      const current = await managedBlockEntry(
        root,
        surface === "CLAUDE.md" ? "claude" : "agent-skills",
      );
      if (
        current === undefined ||
        current.sha256 !== entry.sha256 ||
        JSON.stringify(current.filePrecondition) !== JSON.stringify(entry.filePrecondition)
      ) {
        throw new Error(`Cutover source changed after review: ${entry.source}`);
      }
      continue;
    }
    const current = await readContainedFile(root, join(root, entry.source));
    if (current.length !== entry.bytes || hash(current) !== entry.sha256) {
      throw new Error(`Cutover source changed after review: ${entry.source}`);
    }
  }
};

const collectPlanningIds = async (
  root: string,
): Promise<Readonly<{ roadmaps: Set<string>; gates: Set<string> }>> => {
  const roadmaps = new Set<string>();
  const gates = new Set<string>();
  for (const locator of await safeFiles(root, ".bearing/state")) {
    if (!locator.endsWith(".md")) continue;
    const parsed = parseFrontmatter(
      (await readContainedFile(root, join(root, locator))).toString("utf8"),
    );
    if (!parsed.ok) continue;
    if (parsed.data["Type"] === "roadmap" && typeof parsed.data["ID"] === "string")
      roadmaps.add(parsed.data["ID"]);
    if (parsed.data["Type"] === "milestone-gate" && typeof parsed.data["ID"] === "string")
      gates.add(parsed.data["ID"]);
  }
  return { roadmaps, gates };
};

const convertEfforts = async (
  root: string,
  effortLocators: readonly string[],
  driver: "local-markdown" | "github-issues",
): Promise<readonly TargetPlan[]> => {
  if (driver === "github-issues" && effortLocators.length > 0) {
    throw new Error(
      "Legacy local Effort sidecars do not contain an explicit GitHub scope root. Configure an explicit provider-native GitHub scope before cutover; Bearing will not infer one from .scratch.",
    );
  }
  const ids = new Set<string>();
  const planning = await collectPlanningIds(root);
  const plans: TargetPlan[] = [];
  for (const locator of effortLocators) {
    const source = (await readContainedFile(root, join(root, locator))).toString("utf8");
    const parsed = parseFrontmatter(source);
    if (!parsed.ok) throw new Error(`Legacy Effort has invalid frontmatter: ${locator}`);
    const effort = effortRecordSchema.parse(parsed.data);
    if (ids.has(effort.ID)) throw new Error(`Duplicate Effort identity: ${effort.ID}`);
    ids.add(effort.ID);
    if (!planning.roadmaps.has(effort.Roadmap)) {
      throw new Error(`Legacy Effort has a broken Roadmap reference: ${effort.Roadmap}`);
    }
    if (!planning.gates.has(effort["Target gate"])) {
      throw new Error(`Legacy Effort has a broken Target Gate reference: ${effort["Target gate"]}`);
    }
    const nativeScope = posix.dirname(locator);
    const targetRecord = {
      ...parsed.data,
      "Work binding": {
        Provider: "matt-skills/v1",
        "Native scope": nativeScope,
      },
    };
    const validation = bearingSchema.safeParse(targetRecord);
    if (!validation.success) {
      throw new Error(`Legacy Effort cannot be converted safely: ${locator}`);
    }
    const frontmatter = stringify(targetRecord, { lineWidth: 0 }).trimEnd();
    const slug = effort.ID.slice("effort:".length);
    plans.push({
      target: join(root, ".bearing/state/efforts", `${slug}.md`),
      bytes: Buffer.from(`---\n${frontmatter}\n---\n${parsed.body}`, "utf8"),
      executable: false,
    });
    plans.push({ kind: "delete", target: join(root, locator) });
  }
  return plans;
};

const buildIntegrationPlans = async (
  root: string,
  options: RepositorySetupOptions,
  driver: "local-markdown" | "github-issues",
  effortLocators: readonly string[],
): Promise<readonly TargetPlan[]> => {
  const registrations = validateExecutorRegistrationSelection(
    options.registrations ?? [],
    options.surfaces,
    (options.registrations ?? []).map((registration) => registration.profileKey),
  );
  if ((options.retainProfiles ?? []).length > 0) {
    throw new Error(
      "Legacy executor templates cannot be retained by inference; re-nominate and revalidate them.",
    );
  }
  const manifest = legacyManifestSchema.parse(
    JSON.parse(
      (await readContainedFile(root, join(root, ".bearing/manifest.json"))).toString("utf8"),
    ),
  );
  const actualProfileLocators = await safeFiles(root, ".bearing/executor-profiles");
  const expectedProfileLocators = manifest.executorProfiles
    .map((profile) => `.bearing/executor-profiles/${profile}.md`)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(actualProfileLocators) !== JSON.stringify(expectedProfileLocators)) {
    throw new Error(
      `Legacy Execution Profile inventory is ambiguous. Manifest: [${expectedProfileLocators.join(
        ", ",
      )}]; filesystem: [${actualProfileLocators.join(", ")}].`,
    );
  }
  const packageVersion = packageSchema.parse(
    JSON.parse(await readFile(join(options.packageRoot, "package.json"), "utf8")),
  ).version;
  const plans: TargetPlan[] = [
    {
      target: join(root, ".bearing/manifest.json"),
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            packageVersion,
            status: "active",
            surfaces: [...new Set(options.surfaces)].sort(),
            executorProfiles: registrations.map((registration) => registration.profileKey).sort(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      executable: false,
    },
    {
      target: join(root, ".bearing/provider.json"),
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            provider: options.provider?.key,
            contractLocator: options.provider?.contractLocator,
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      executable: false,
    },
    ...(await convertEfforts(root, effortLocators, driver)),
  ];
  for (const registration of registrations) {
    plans.push({
      target: join(root, ".bearing/executor-profiles", `${registration.profileKey}.md`),
      bytes: renderExecutionProfile(registration),
      executable: false,
    });
  }
  for (const legacyProfile of manifest.executorProfiles) {
    if (registrations.some((registration) => registration.profileKey === legacyProfile)) continue;
    const target = join(root, ".bearing/executor-profiles", `${legacyProfile}.md`);
    if ((await readOptionalContained(root, target)) !== undefined)
      plans.push({ kind: "delete", target });
  }
  for (const surface of AGENT_SURFACES) {
    const target = join(root, agentSurfaceEntryFile(surface));
    const existing = await readOptionalContained(root, target);
    if (existing === undefined) continue;
    const source = existing.toString("utf8");
    const revised = options.surfaces.includes(surface)
      ? withBearingManagedPointer(source)
      : withoutBearingManagedPointer(source);
    if (revised !== source) {
      plans.push({ target, bytes: Buffer.from(revised, "utf8"), executable: false });
    }
  }
  for (const cacheFile of await safeFiles(root, ".bearing/cache")) {
    plans.push({ kind: "delete", target: join(root, cacheFile) });
  }
  return plans.sort((left, right) => left.target.localeCompare(right.target, "en"));
};

const cutoverConfirmationToken = (
  root: string,
  createdAt: string,
  recoveryEntries: readonly RecoveryEntry[],
  integrationPlans: readonly TargetPlan[],
  contractBytes: Buffer,
  options: RepositorySetupOptions,
): string =>
  hash(
    Buffer.from(
      JSON.stringify({
        sourceSchema: SOURCE_SCHEMA,
        targetSchema: TARGET_SCHEMA,
        createdAt,
        recoveryInventoryHash: hash(inventoryBytes(createdAt, recoveryEntries)),
        providerContractHash: hash(contractBytes),
        selection: {
          surfaces: [...new Set(options.surfaces)].sort(),
          provider: options.provider,
          registrations: options.registrations ?? [],
          retainProfiles: options.retainProfiles ?? [],
          removeProfiles: options.removeProfiles ?? [],
        },
        targets: integrationPlans.map((plan) => ({
          target: relative(root, plan.target).split(sep).join("/"),
          kind: plan.kind ?? "file",
          ...("bytes" in plan ? { bytes: plan.bytes.length, sha256: hash(plan.bytes) } : {}),
        })),
      }),
      "utf8",
    ),
  );

export const cutOverLegacyRepository = async (
  unresolvedRoot: string,
  options: RepositorySetupOptions,
  hooks: Readonly<{
    writeTarget?: InstallTargetWriter;
    writeRecoveryTarget?: InstallTargetWriter;
  }> = {},
): Promise<RepositorySetupResult> => {
  const root = await resolveRepositoryRoot(unresolvedRoot);
  if (options.acceptUpgradeDirection !== true) {
    throw new Error(
      "Legacy repository cutover requires --accept-upgrade-direction; no repository writes were made.",
    );
  }
  if (options.confirmCutover !== true) {
    throw new Error(
      "Legacy repository cutover requires --confirm-cutover after the complete inspected Apply review; no repository writes were made.",
    );
  }
  const timestamp = cutoverTimestamp(options.cutoverAt);
  const effortLocators = await legacyEffortLocators(root);
  const unexpectedCanonicalEfforts = await safeFiles(root, ".bearing/state/efforts");
  if (unexpectedCanonicalEfforts.length > 0) {
    throw new Error(
      `Legacy repository has an ambiguous canonical Effort target: ${unexpectedCanonicalEfforts.join(", ")}`,
    );
  }
  const providerInspection = await inspectMattProviderContract(
    root,
    options.provider?.contractLocator ?? "",
    options.surfaces,
  );
  const contractBytes = await readContainedFile(
    root,
    join(root, options.provider?.contractLocator ?? ""),
  );
  const validation = validateMattSkillsV1Contract(contractBytes.toString("utf8"));
  if (validation.state !== "supported") {
    throw new Error("Legacy cutover requires one trustworthy matt-skills/v1 provider contract.");
  }
  await convertEfforts(root, effortLocators, validation.driver);
  await assertLegacySourceSyncClean(root, effortLocators);
  const bundleRelative = posix.join(".bearing/backups", `0.1.0-to-0.1.1-${timestamp.suffix}`);
  const bundleRoot = join(root, bundleRelative);
  const recoveryEntries = await buildRecoveryEntries(root, effortLocators);
  const plans = await buildIntegrationPlans(root, options, validation.driver, effortLocators);
  const manifestPlan = plans.find(
    (plan) => "bytes" in plan && plan.target === join(root, ".bearing/manifest.json"),
  );
  if (manifestPlan === undefined || !("bytes" in manifestPlan)) {
    throw new Error("Cutover plan did not contain its required target manifest.");
  }
  const expectedManifestBytes = manifestPlan.bytes;
  const confirmationToken = cutoverConfirmationToken(
    root,
    timestamp.iso,
    recoveryEntries,
    plans,
    contractBytes,
    options,
  );
  if (options.cutoverPlanToken === undefined || options.cutoverPlanToken !== confirmationToken) {
    throw new Error(
      "Cutover inspected generation changed or --cutover-plan-token is missing; rerun --plan and obtain a new final Apply confirmation. No repository writes were made.",
    );
  }
  const planPreconditions = await captureRepositoryTargetPreconditions(
    root,
    plans.map((plan) => relative(root, plan.target).split(sep).join("/")),
  );
  await preflightInstallTargets(
    root,
    plans.map((plan) => plan.target),
  );
  await createAndVerifyRecoveryBundle(
    root,
    bundleRoot,
    timestamp.iso,
    recoveryEntries,
    hooks.writeRecoveryTarget,
  );
  await assertRecoverySourcesCurrent(root, recoveryEntries);
  let syncPlans: readonly TargetPlan[] = [];
  const result = await applyInstallPlans(
    root,
    plans,
    hooks.writeTarget,
    async () => {
      const currentEffortLocators = await legacyEffortLocators(root);
      const currentCanonicalEfforts = await safeFiles(root, ".bearing/state/efforts");
      if (currentCanonicalEfforts.length > 0) {
        throw new Error(
          `Cutover target appeared after review: ${currentCanonicalEfforts.join(", ")}`,
        );
      }
      const currentRecoveryEntries = await buildRecoveryEntries(root, currentEffortLocators);
      const currentPlans = await buildIntegrationPlans(
        root,
        options,
        validation.driver,
        currentEffortLocators,
      );
      if (
        !equalRecoveryGeneration(timestamp.iso, recoveryEntries, currentRecoveryEntries) ||
        cutoverConfirmationToken(
          root,
          timestamp.iso,
          currentRecoveryEntries,
          currentPlans,
          contractBytes,
          options,
        ) !== confirmationToken
      ) {
        throw new Error(
          "Cutover source generation changed after final Apply review; re-inspection and consent are required.",
        );
      }
      await assertRepositoryTargetPreconditionsCurrent(root, planPreconditions);
      await assertRecoverySourcesCurrent(root, recoveryEntries);
      await assertMattProviderContractCurrent(
        root,
        options.provider?.contractLocator ?? "",
        options.surfaces,
        providerInspection,
      );
      if (options.executorHomeDir !== undefined) {
        await assertExecutorRegistrationsCurrent(
          options.executorHomeDir,
          options.registrations ?? [],
        );
      }
      await verifyRecoveryBundle(root, bundleRoot);
    },
    async () => {
      const sync = await prepareSync(root, {
        providerObservationIntent: "recovery",
      });
      if (sync.diagnostics.length > 0) {
        throw new Error(
          `Cutover target validation requires zero Sync diagnostics; found ${sync.diagnostics
            .map((diagnostic) => diagnostic.code)
            .join(", ")}.`,
        );
      }
      syncPlans = buildSyncTransactionTargets(sync, {
        packageName: packageMetadata.name,
        packageVersion: packageMetadata.version,
        completedAt: timestamp.iso,
      }).targets;
      return syncPlans;
    },
    async () => {
      const manifestBytes = await readContainedFile(root, join(root, ".bearing/manifest.json"));
      if (!manifestBytes.equals(expectedManifestBytes)) {
        throw new Error("Cutover target manifest does not match the protected plan.");
      }
      const manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
      if (!manifestSchema.safeParse(manifest).success || !("status" in (manifest as object))) {
        throw new Error("Cutover target manifest did not validate.");
      }
      await verifyRecoveryBundle(root, bundleRoot);
    },
  );
  return {
    outcome: result.outcome,
    manifestPath: join(root, ".bearing/manifest.json"),
    changedTargets: result.changedTargets,
    recoveryBundlePath: bundleRelative,
    cutover: {
      sourceSchema: SOURCE_SCHEMA,
      targetSchema: TARGET_SCHEMA,
      recoveryBundleVerified: true,
      targetValidation: "zero-diagnostics",
    },
  };
};

export type LegacyCutoverPlan = Readonly<{
  sourceSchema: typeof SOURCE_SCHEMA;
  targetSchema: typeof TARGET_SCHEMA;
  recoveryBundlePath: string;
  confirmationToken: string;
  objectCounts: Readonly<{
    stateFiles: number;
    efforts: number;
    legacyProfiles: number;
    managedBlocks: number;
    recoveryEntries: number;
  }>;
  pathDispositions: readonly Readonly<{
    target: string;
    disposition: "create-or-replace" | "remove";
  }>[];
  preservedNativeScopes: readonly string[];
  excludedFromRecoveryBundle: readonly [
    "cache",
    "Matt-native work",
    "unmanaged content",
    "external Assets",
  ];
}>;

export const inspectLegacyCutoverPlan = async (
  unresolvedRoot: string,
  options: RepositorySetupOptions,
): Promise<LegacyCutoverPlan> => {
  const root = await resolveRepositoryRoot(unresolvedRoot);
  const timestamp = cutoverTimestamp(options.cutoverAt);
  const effortLocators = await legacyEffortLocators(root);
  const unexpectedCanonicalEfforts = await safeFiles(root, ".bearing/state/efforts");
  if (unexpectedCanonicalEfforts.length > 0) {
    throw new Error(
      `Legacy repository has an ambiguous canonical Effort target: ${unexpectedCanonicalEfforts.join(", ")}`,
    );
  }
  const providerInspection = await inspectMattProviderContract(
    root,
    options.provider?.contractLocator ?? "",
    options.surfaces,
  );
  if (!providerInspection.supported) {
    throw new Error(
      "Legacy cutover requires every selected Agent Surface to point at one trustworthy matt-skills/v1 provider contract before the final Apply review.",
    );
  }
  const contractBytes = await readContainedFile(
    root,
    join(root, options.provider?.contractLocator ?? ""),
  );
  const validation = validateMattSkillsV1Contract(contractBytes.toString("utf8"));
  if (validation.state !== "supported") {
    throw new Error("Legacy cutover requires one trustworthy matt-skills/v1 provider contract.");
  }
  await convertEfforts(root, effortLocators, validation.driver);
  const recoveryEntries = await buildRecoveryEntries(root, effortLocators);
  await assertLegacySourceSyncClean(root, effortLocators);
  const integrationPlans = await buildIntegrationPlans(
    root,
    options,
    validation.driver,
    effortLocators,
  );
  const legacyManifest = legacyManifestSchema.parse(
    JSON.parse(
      (await readContainedFile(root, join(root, ".bearing/manifest.json"))).toString("utf8"),
    ),
  );
  return Object.freeze({
    sourceSchema: SOURCE_SCHEMA,
    targetSchema: TARGET_SCHEMA,
    recoveryBundlePath: posix.join(".bearing/backups", `0.1.0-to-0.1.1-${timestamp.suffix}`),
    confirmationToken: cutoverConfirmationToken(
      root,
      timestamp.iso,
      recoveryEntries,
      integrationPlans,
      contractBytes,
      options,
    ),
    objectCounts: Object.freeze({
      stateFiles: (await safeFiles(root, ".bearing/state")).length,
      efforts: effortLocators.length,
      legacyProfiles: legacyManifest.executorProfiles.length,
      managedBlocks: recoveryEntries.filter((entry) =>
        entry.source.endsWith("#bearing-managed-block"),
      ).length,
      recoveryEntries: recoveryEntries.length,
    }),
    pathDispositions: Object.freeze(
      integrationPlans.map((plan) =>
        Object.freeze({
          target: relative(root, plan.target).split(sep).join("/"),
          disposition:
            plan.kind === "delete" ? ("remove" as const) : ("create-or-replace" as const),
        }),
      ),
    ),
    preservedNativeScopes: Object.freeze(effortLocators.map((locator) => posix.dirname(locator))),
    excludedFromRecoveryBundle: Object.freeze([
      "cache",
      "Matt-native work",
      "unmanaged content",
      "external Assets",
    ] as const),
  });
};

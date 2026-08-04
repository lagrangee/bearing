import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, readFile, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import packageMetadata from "../package.json";
import { writeFileAtomically } from "./atomic-write";
import { inspectRepository } from "./catalog/repository-inspection";
import {
  assertExecutorWritebackSelectionCurrent,
  type ExecutorWritebackSelection,
  resolveExecutorWritebackProfile,
} from "./executor-registration";
import { ensureInstallDirectoryTargets, inspectInstallPath } from "./install-boundary";
import { applyInstallPlans, type InstallTargetWriter } from "./installer";
import { parseMarkdownEnvelope, serializeMarkdownDocument } from "./markdown-document";
import { displaySourceLocatorSchema } from "./reference-schema";
import { assetSchema, repositoryManifestSchema } from "./schema-definitions";
import { bearingOwnedEventTimeSchema, sourceOwnedEventTimeValueSchema } from "./source-event-time";
import { prepareSync } from "./sync-plan";
import { buildSyncTransactionTargets } from "./sync-transaction";

const producerKindSchema = z.enum(["executor-profile", "agent-capability", "external-source"]);
const producerNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const repositoryProducerReferenceSchema = displaySourceLocatorSchema.refine(
  (value) =>
    !value.includes(":") &&
    !value.startsWith("-") &&
    (value.includes("/") || /(?:^|\/)[^/]+\.[a-z0-9]+$/iu.test(value)),
  { message: "Repository Producer References cannot use transient namespaces." },
);
const externalProducerReferenceSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "External Producer References must use HTTPS.",
  })
  .refine(
    (value) =>
      !/(?:^|\.)(?:chatgpt\.com|chat\.openai\.com|claude\.ai)$/iu.test(new URL(value).hostname),
    { message: "Conversation URLs are not durable Producer References." },
  );
const producerReferenceSchema = z.union([
  repositoryProducerReferenceSchema,
  externalProducerReferenceSchema,
  z.string().regex(/^commit:[0-9a-f]{7,64}$/u),
]);

const registrationInputSchema = z
  .strictObject({
    repoRoot: z.string().min(1),
    id: z.string(),
    title: z.string(),
    kind: z.string(),
    location: z.string(),
    owner: z.string(),
    producer: z.strictObject({
      kind: producerKindSchema,
      name: producerNameSchema,
      reference: producerReferenceSchema.optional(),
    }),
    executorCapabilityLocator: z
      .string()
      .regex(/^(agent-skills|claude):([a-z0-9]+(?:-[a-z0-9]+)*)$/u)
      .optional(),
    producedFor: z.string().optional(),
    producedAt: sourceOwnedEventTimeValueSchema.optional(),
  })
  .superRefine((input, context) => {
    if (
      input.producer.kind === "executor-profile" &&
      input.executorCapabilityLocator === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["executorCapabilityLocator"],
        message: "Executor Profile provenance requires the actual executor capability locator.",
      });
    }
    if (
      input.producer.kind !== "executor-profile" &&
      input.executorCapabilityLocator !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["executorCapabilityLocator"],
        message:
          "Executor capability matching is valid only for executor-profile Producer provenance.",
      });
    }
  });

const assetRegistrySchema = z.strictObject({
  Type: z.literal("asset-registry"),
  Assets: z
    .array(assetSchema)
    .refine((assets) => new Set(assets.map((asset) => asset.ID)).size === assets.length, {
      message: "Asset Registry identities must be unique.",
    }),
});

export type AssetRegistrationInput = z.input<typeof registrationInputSchema>;

export type AssetRegistrationResult = Readonly<
  | {
      outcome: "no-op";
      assetId: string;
      writebackProfile?: ExecutorWritebackSelection;
    }
  | {
      outcome: "applied";
      assetId: string;
      writebackProfile?: ExecutorWritebackSelection;
      sync: Readonly<{
        fingerprint: string;
        diagnostics: 0;
        outcome: "applied" | "no-op";
      }>;
    }
>;

type FileSnapshot = Readonly<{
  bytes?: Buffer;
  mode: number;
}>;

const REGISTRY_BODY =
  "\n# Asset Registry\n\nThis registry stores metadata and locations only. Asset content remains at its source location. `cited_by` and `citation_count` are derived and must not be written here.\n";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const inspectRegistry = async (target: string): Promise<FileSnapshot> => {
  const state = await inspectInstallPath(target);
  if (state.kind === "missing") return { mode: 0o644 };
  if (state.kind !== "file" || state.linkCount !== 1) {
    throw new Error("Asset Registry must be one safe single-link regular file.");
  }
  return { bytes: await readFile(target), mode: state.mode & 0o7777 };
};

const parseRegistry = (
  snapshot: FileSnapshot,
): Readonly<{ registry: z.infer<typeof assetRegistrySchema>; body: string }> => {
  if (snapshot.bytes === undefined) {
    return { registry: { Type: "asset-registry", Assets: [] }, body: REGISTRY_BODY };
  }
  const parsed = parseMarkdownEnvelope(snapshot.bytes.toString("utf8"));
  if (!parsed.ok) throw new Error("Asset Registry frontmatter is missing or malformed.");
  return {
    registry: assetRegistrySchema.parse(parsed.data),
    body: parsed.body,
  };
};

const serializeRegistry = (registry: z.infer<typeof assetRegistrySchema>, body: string): Buffer => {
  return Buffer.from(serializeMarkdownDocument({ frontmatter: registry, body }), "utf8");
};

const assetFromInput = (
  input: z.infer<typeof registrationInputSchema>,
  registeredAt?: string,
): z.infer<typeof assetSchema> =>
  assetSchema.parse({
    ID: input.id,
    Title: input.title,
    Kind: input.kind,
    Location: input.location,
    Owner: input.owner,
    Producer: {
      Kind: input.producer.kind,
      Name: input.producer.name,
      ...(input.producer.reference === undefined ? {} : { Reference: input.producer.reference }),
    },
    "Lifecycle source": "native",
    ...(registeredAt === undefined ? {} : { "Registered at": registeredAt }),
    ...(input.producedFor === undefined ? {} : { "Produced for": input.producedFor }),
    ...(input.producedAt === undefined ? {} : { "Produced at": input.producedAt }),
  });

const registrationOwnedMetadata = (asset: z.infer<typeof assetSchema>) => ({
  ID: asset.ID,
  Title: asset.Title,
  Kind: asset.Kind,
  Location: asset.Location,
  Owner: asset.Owner,
  Producer: asset.Producer,
  "Lifecycle source": asset["Lifecycle source"],
  ...(asset["Produced for"] === undefined ? {} : { "Produced for": asset["Produced for"] }),
  ...(asset["Produced at"] === undefined ? {} : { "Produced at": asset["Produced at"] }),
});

const equalRegistrationMetadata = (
  left: z.infer<typeof assetSchema>,
  right: z.infer<typeof assetSchema>,
): boolean =>
  JSON.stringify(registrationOwnedMetadata(left)) ===
  JSON.stringify(registrationOwnedMetadata(right));

const assertSafeSingleLinkFile = async (
  root: string,
  reference: string,
  description: string,
): Promise<void> => {
  const referenceTarget = join(root, reference);
  await ensureInstallDirectoryTargets(root, [referenceTarget]);
  const referenceState = await inspectInstallPath(referenceTarget);
  if (referenceState.kind !== "file" || referenceState.linkCount !== 1) {
    throw new Error(`${description} is unavailable or unsafe: ${reference}`);
  }
};

const safeSkillContractExists = async (skillDirectory: string): Promise<boolean> => {
  const directoryState = await inspectInstallPath(skillDirectory);
  if (directoryState.kind !== "directory" && directoryState.kind !== "symbolic-link") return false;
  let resolvedDirectory: string;
  try {
    resolvedDirectory = await realpath(skillDirectory);
  } catch {
    return false;
  }
  if ((await inspectInstallPath(resolvedDirectory)).kind !== "directory") return false;
  const contract = join(resolvedDirectory, "SKILL.md");
  try {
    await ensureInstallDirectoryTargets(resolvedDirectory, [contract]);
  } catch {
    return false;
  }
  const contractState = await inspectInstallPath(contract);
  return contractState.kind === "file" && contractState.linkCount === 1;
};

const assertInstalledCapabilityExists = async (name: string): Promise<void> => {
  const surfaceRoot = homedir();
  const candidates = [
    join(PACKAGE_ROOT, "skills", name),
    join(surfaceRoot, ".agents/skills", name),
    join(surfaceRoot, ".codex/skills", name),
    join(surfaceRoot, ".claude/skills", name),
  ];
  for (const skillDirectory of candidates) {
    if (await safeSkillContractExists(skillDirectory)) return;
  }
  throw new Error(`Agent Capability is not installed on this Agent Surface: ${name}`);
};

const assertCommitExists = async (root: string, reference: string): Promise<void> => {
  const commit = reference.slice("commit:".length);
  const child = spawn("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`], {
    stdio: "ignore",
  });
  const [exitCode] = (await once(child, "close")) as [number | null];
  if (exitCode !== 0) {
    throw new Error(`Producer commit does not exist in the repository: ${commit}`);
  }
};

const externalSourceNameForUrl = (reference: string): string => {
  const url = new URL(reference);
  if (url.hostname === "github.com" && /\/actions\/runs\/[1-9][0-9]*(?:\/|$)/u.test(url.pathname)) {
    return "github-actions";
  }
  const labels = url.hostname.toLowerCase().split(".");
  const identityLabels = labels[0] === "www" ? labels.slice(1, -1) : labels.slice(0, -1);
  return identityLabels.join("-");
};

const assertProducerIsDurable = async (
  root: string,
  producer: z.infer<typeof registrationInputSchema>["producer"],
): Promise<void> => {
  if (
    producer.reference !== undefined &&
    repositoryProducerReferenceSchema.safeParse(producer.reference).success
  ) {
    await assertSafeSingleLinkFile(root, producer.reference, "Repository Producer Reference");
  }
  if (producer.reference?.startsWith("commit:")) {
    await assertCommitExists(root, producer.reference);
  }
  if (producer.kind === "executor-profile") {
    const manifest = repositoryManifestSchema.parse(
      JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8")),
    );
    if (producer.name !== "generic-agent" && !manifest.executorProfiles.includes(producer.name)) {
      throw new Error(`Executor Profile is not configured for this repository: ${producer.name}`);
    }
    return;
  }
  if (producer.kind === "agent-capability") {
    await assertInstalledCapabilityExists(producer.name);
    return;
  }
  if (producer.name === "user") return;
  if (
    producer.reference === undefined ||
    !externalProducerReferenceSchema.safeParse(producer.reference).success ||
    externalSourceNameForUrl(producer.reference) !== producer.name
  ) {
    throw new Error(
      "External Source Producer must be user or match the identity of its durable HTTPS Reference.",
    );
  }
};

const assertCurrentRegistryBytes = async (target: string, expected: Buffer): Promise<void> => {
  const state = await inspectInstallPath(target);
  if (state.kind !== "file" || state.linkCount !== 1) {
    throw new Error("Asset Registry changed to an unsafe shape during registration.");
  }
  if (!(await readFile(target)).equals(expected)) {
    throw new Error("Asset Registry changed during registration.");
  }
};

const assertRegistrySnapshotCurrent = async (
  target: string,
  expected: FileSnapshot,
): Promise<void> => {
  const state = await inspectInstallPath(target);
  if (expected.bytes === undefined) {
    if (state.kind !== "missing") {
      throw new Error("Asset Registry changed before registration.");
    }
    return;
  }
  if (
    state.kind !== "file" ||
    state.linkCount !== 1 ||
    (state.mode & 0o7777) !== expected.mode ||
    !(await readFile(target)).equals(expected.bytes)
  ) {
    throw new Error("Asset Registry changed before registration.");
  }
};

const restoreRegistry = async (
  target: string,
  previous: FileSnapshot,
  proposed: Buffer,
): Promise<void> => {
  await assertCurrentRegistryBytes(target, proposed);
  if (previous.bytes === undefined) {
    await unlink(target);
    return;
  }
  await writeFileAtomically(target, previous.bytes, previous.mode);
  await chmod(target, previous.mode);
};

export const registerAsset = async (
  rawInput: AssetRegistrationInput,
  hooks: Readonly<{
    beforeRegistrySnapshot?: () => Promise<void>;
    writeSyncTarget?: InstallTargetWriter;
    now?: () => Date;
  }> = {},
): Promise<AssetRegistrationResult> => {
  const input = registrationInputSchema.parse(rawInput);
  const inspection = await inspectRepository(input.repoRoot, { requireCanonical: false });
  if (inspection.kind !== "available") {
    throw new Error("Asset registration requires a repository with a safe Bearing manifest.");
  }
  const root = inspection.canonicalRoot;
  let writebackProfile: ExecutorWritebackSelection | undefined;
  if (input.executorCapabilityLocator !== undefined) {
    if (input.producer.kind !== "executor-profile") {
      throw new Error(
        "Executor capability matching is valid only for executor-profile Producer provenance.",
      );
    }
    writebackProfile = await resolveExecutorWritebackProfile(root, input.executorCapabilityLocator);
    if (input.producer.name !== writebackProfile.profileKey) {
      throw new Error(
        `Executor Profile provenance does not match the actual capability: expected ${writebackProfile.profileKey}.`,
      );
    }
  }
  await assertProducerIsDurable(root, input.producer);
  const registryPath = join(root, ".bearing/state/assets.md");
  await ensureInstallDirectoryTargets(root, [registryPath]);
  if ((await inspectInstallPath(dirname(registryPath))).kind !== "directory") {
    throw new Error("Asset registration requires a safe Bearing State directory.");
  }
  const previous = await inspectRegistry(registryPath);
  const current = parseRegistry(previous);
  const registrationCandidate = assetFromInput(input);
  const existing = current.registry.Assets.find(
    (candidate) => candidate.ID === registrationCandidate.ID,
  );
  if (existing !== undefined) {
    if (equalRegistrationMetadata(existing, registrationCandidate)) {
      if (writebackProfile !== undefined) {
        await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
      }
      return {
        outcome: "no-op",
        assetId: registrationCandidate.ID,
        ...(writebackProfile === undefined ? {} : { writebackProfile }),
      };
    }
    throw new Error(
      `Asset ${registrationCandidate.ID} is already registered with different metadata.`,
    );
  }

  const registeredAt = bearingOwnedEventTimeSchema
    .unwrap()
    .parse((hooks.now?.() ?? new Date()).toISOString());
  const asset = assetFromInput(input, registeredAt);
  const proposedRegistry = assetRegistrySchema.parse({
    Type: "asset-registry",
    Assets: [...current.registry.Assets, asset],
  });
  const proposed = serializeRegistry(proposedRegistry, current.body);
  let registryApplied = false;
  try {
    await applyInstallPlans(
      root,
      [
        {
          target: registryPath,
          bytes: proposed,
          executable: false,
          mode: previous.mode,
        },
      ],
      undefined,
      async () => {
        await hooks.beforeRegistrySnapshot?.();
        if (writebackProfile !== undefined) {
          await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
        }
        await assertRegistrySnapshotCurrent(registryPath, previous);
      },
      async () => {
        if (writebackProfile !== undefined) {
          await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
        }
        return undefined;
      },
      async () => {
        if (writebackProfile !== undefined) {
          await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
        }
      },
    );
    registryApplied = true;
    if (writebackProfile !== undefined) {
      await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
    }
    const syncPlan = await prepareSync(root);
    await assertCurrentRegistryBytes(registryPath, proposed);
    if (syncPlan.diagnostics.length > 0) {
      throw new Error(
        `Asset registration produced ${syncPlan.diagnostics.length} structural diagnostics.`,
      );
    }
    const syncTransaction = buildSyncTransactionTargets(syncPlan, {
      packageName: packageMetadata.name,
      packageVersion: packageMetadata.version,
      completedAt: new Date().toISOString(),
    });
    const syncResult = await applyInstallPlans(
      root,
      syncTransaction.targets,
      hooks.writeSyncTarget,
      async () => {
        if (writebackProfile !== undefined) {
          await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
        }
        await assertCurrentRegistryBytes(registryPath, proposed);
      },
      async () => {
        if (writebackProfile !== undefined) {
          await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
        }
        return undefined;
      },
      async () => {
        if (writebackProfile !== undefined) {
          await assertExecutorWritebackSelectionCurrent(root, writebackProfile);
        }
      },
    );
    return {
      outcome: "applied",
      assetId: asset.ID,
      ...(writebackProfile === undefined ? {} : { writebackProfile }),
      sync: {
        fingerprint: syncPlan.fingerprint,
        diagnostics: 0,
        outcome: syncResult.outcome,
      },
    };
  } catch (error) {
    if (registryApplied) {
      try {
        await restoreRegistry(registryPath, previous, proposed);
      } catch (rollbackError) {
        throw new Error("Asset registration and Registry rollback both failed.", {
          cause: rollbackError,
        });
      }
    }
    throw new Error(
      registryApplied
        ? "Asset registration failed; Registry bytes were restored."
        : "Asset registration failed before Registry mutation.",
      { cause: error },
    );
  }
};

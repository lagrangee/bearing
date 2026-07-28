import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { AGENT_SURFACES, agentSurfaceEntryFile, bearingManagedRange } from "./agent-surface-entry";
import { readCatalogState } from "./catalog/store";
import { inspectInstallPath } from "./install-boundary";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans } from "./installer";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import {
  decodeMattProviderConfiguration,
  type MattProviderConfigurationFile,
} from "./provider-configuration";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import { manifestSchema } from "./schema-definitions";
import { prepareSync } from "./sync-plan";
import type { AgentSurface } from "./types";

const lifecycleManifestSchema = manifestSchema.extend({
  status: z.enum(["active", "deactivated"]),
});

const hash = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export type RepositoryRecoveryChoice = Readonly<{
  kind:
    | "compatible-kit"
    | "bounded-cutover"
    | "rebuild-integration-envelope"
    | "restore-bundle"
    | "explicit-object-disposition"
    | "owner-repair"
    | "catalog-identity-repair"
    | "purge";
  owner: "package-manager" | "bearing-setup" | "matt-skills" | "agent-surface" | "user";
  order: number;
  nextAction: string;
  mutationScope: string;
}>;

export type RepositoryRecoveryDiagnosis = Readonly<{
  classification: "fresh" | "active" | "deactivated" | "legacy-cutover" | "invalid-or-unsupported";
  applied: false;
  blockers: readonly Readonly<{
    cause:
      | "unsafe-namespace"
      | "newer-schema"
      | "recognized-older-schema"
      | "missing-manifest"
      | "corrupt-manifest"
      | "invalid-lifecycle-envelope"
      | "invalid-state-object"
      | "owner-dependency"
      | "catalog-conflict";
    impact: string;
    trustworthyInputs: readonly string[];
    unsafeInputs: readonly string[];
    recoveryChoices: readonly RepositoryRecoveryChoice[];
  }>[];
}>;

const choice = (
  kind: RepositoryRecoveryChoice["kind"],
  owner: RepositoryRecoveryChoice["owner"],
  order: number,
  nextAction: string,
  mutationScope: string,
): RepositoryRecoveryChoice => ({ kind, owner, order, nextAction, mutationScope });

type VerifiedRecoveryBundleEvidence = Readonly<{
  sourceSchema: "bearing-repository/v0.1.0";
  targetSchema: "bearing-repository/v0.1.1";
  sources: readonly string[];
}>;

const verifiedRecoveryBundleAvailable = async (
  root: string,
): Promise<VerifiedRecoveryBundleEvidence | undefined> => {
  let items: readonly NamespaceItem[];
  try {
    items = await inventoryNamespace(root);
  } catch {
    return undefined;
  }
  const receipts = items.filter(
    (item) => item.kind === "file" && item.target.endsWith("/receipt.json"),
  );
  const { verifyRecoveryBundle } = await import("./repository-cutover");
  for (const receipt of receipts) {
    const match = /^\.bearing\/backups\/([^/]+)\/receipt\.json$/u.exec(receipt.target);
    if (match === null) continue;
    const bundleName = match[1];
    if (bundleName === undefined) continue;
    try {
      const { inventory } = await verifyRecoveryBundle(
        root,
        join(root, ".bearing/backups", bundleName),
      );
      return {
        sourceSchema: inventory.sourceSchema,
        targetSchema: inventory.targetSchema,
        sources: inventory.entries.map((entry) => entry.source),
      };
    } catch {}
  }
  return undefined;
};

const purgeIsSafelyIdentifiable = async (root: string, homeDir?: string): Promise<boolean> => {
  try {
    if (homeDir !== undefined)
      return (await preparePurge({ repoRoot: root, homeDir })).plan.canPurge;
    const namespace = await inventoryNamespace(root);
    if (namespace[0]?.target !== ".bearing" || namespace[0].kind !== "directory") return false;
    const manifest = namespace.find((item) => item.target === ".bearing/manifest.json");
    let parsed: unknown;
    if (manifest?.bytesValue !== undefined) {
      try {
        parsed = JSON.parse(manifest.bytesValue.toString("utf8"));
      } catch {
        parsed = undefined;
      }
    }
    const lifecycle = lifecycleManifestSchema.safeParse(parsed);
    const discovered = (
      await Promise.all(
        (lifecycle.success ? lifecycle.data.surfaces : AGENT_SURFACES).map((surface) =>
          inspectManagedBlock(root, surface),
        ),
      )
    ).filter((item) => item !== undefined);
    if (!lifecycle.success && discovered.length > 0) return false;
    return true;
  } catch {
    return false;
  }
};

const stateChoices = async (
  root: string,
  homeDir?: string,
): Promise<readonly RepositoryRecoveryChoice[]> => {
  const choices: RepositoryRecoveryChoice[] = [];
  const bundle = await verifiedRecoveryBundleAvailable(root);
  if (bundle !== undefined) {
    choices.push(
      choice(
        "restore-bundle",
        "bearing-setup",
        choices.length + 1,
        "Inspect and explicitly select one strictly verified 0.1.0 Recovery Bundle, restore its exact payload set, then run the controlled 0.1.1 reconversion.",
        `The selected bundle's ${bundle.sources.length} verified sources, including any recorded legacy sidecars and managed blocks; restoration returns to ${bundle.sourceSchema} before reconversion to ${bundle.targetSchema}.`,
      ),
    );
  }
  choices.push(
    choice(
      "explicit-object-disposition",
      "user",
      choices.length + 1,
      "Review each invalid canonical object and accept one specific repair or removal.",
      "Only the named invalid canonical objects in `.bearing/state`.",
    ),
  );
  if (await purgeIsSafelyIdentifiable(root, homeDir)) {
    choices.push(
      choice(
        "purge",
        "user",
        choices.length + 1,
        "Inspect the exact Purge inventory, choose export or non-recovery, then confirm.",
        "The identified 0.1.1 namespace, verified managed blocks, and matching Catalog entry.",
      ),
    );
  }
  return choices;
};

const invalidStateInputs = async (
  root: string,
): Promise<readonly Readonly<{ target: string; message: string }>[]> => {
  try {
    const sync = await prepareSync(root);
    const unique = new Map<string, string>();
    for (const diagnostic of sync.diagnostics) {
      if (
        diagnostic.impact === "blocking" &&
        diagnostic.target.startsWith(".bearing/state") &&
        !unique.has(diagnostic.target)
      ) {
        unique.set(diagnostic.target, diagnostic.message);
      }
    }
    return [...unique].map(([target, message]) => ({ target, message }));
  } catch {
    return [
      {
        target: ".bearing/state",
        message: "Canonical State could not be independently validated.",
      },
    ];
  }
};

const workManagementPointerPattern = /^Work-management contract:\s*`([^`\r\n]+)`\s*$/gmu;

const pointsToContract = (source: string, locator: string): boolean => {
  const declarations = [...source.matchAll(workManagementPointerPattern)];
  return declarations.length === 1 && declarations[0]?.[1] === locator;
};

const dependencyBlockers = async (
  root: string,
  manifest: z.infer<typeof lifecycleManifestSchema>,
  homeDir?: string,
): Promise<RepositoryRecoveryDiagnosis["blockers"]> => {
  const blockers: RepositoryRecoveryDiagnosis["blockers"][number][] = [];
  const invalidSurfaces = new Set<AgentSurface>();
  for (const surface of manifest.surfaces) {
    const locator = agentSurfaceEntryFile(surface);
    const state = await inspectInstallPath(join(root, locator));
    let valid = state.kind === "missing" || (state.kind === "file" && state.linkCount === 1);
    if (state.kind === "file" && state.linkCount === 1) {
      try {
        const bytes = await readContainedFile(root, join(root, locator));
        bearingManagedRange(bytes.toString("utf8"));
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      invalidSurfaces.add(surface);
      blockers.push({
        cause: "owner-dependency",
        impact: `Registered Agent Surface ${locator} is unsafe or has ambiguous managed-block ownership.`,
        trustworthyInputs: [".bearing/manifest.json", ".bearing/state"],
        unsafeInputs: [locator],
        recoveryChoices: [
          choice(
            "owner-repair",
            "agent-surface",
            1,
            `Repair ${locator} through its owning Agent Surface, then resume Setup revalidation.`,
            `${locator} only; Bearing State and provider selection remain unchanged.`,
          ),
        ],
      });
    }
  }

  const providerTarget = join(root, ".bearing/provider.json");
  let provider: MattProviderConfigurationFile | undefined;
  try {
    const state = await inspectInstallPath(providerTarget);
    if (state.kind === "file" && state.linkCount === 1) {
      provider = decodeMattProviderConfiguration(
        (await readContainedFile(root, providerTarget)).toString("utf8"),
      );
    }
  } catch {
    provider = undefined;
  }
  let providerInput = ".bearing/provider.json";
  let providerValid = provider !== undefined;
  if (provider !== undefined) {
    providerInput = provider.contractLocator;
    try {
      const contract = await readContainedFile(root, join(root, provider.contractLocator));
      providerValid = validateMattSkillsV1Contract(contract.toString("utf8")).state === "supported";
    } catch {
      providerValid = false;
    }
  }
  if (!providerValid) {
    blockers.push({
      cause: "owner-dependency",
      impact: "The configured Matt provider contract cannot be safely revalidated.",
      trustworthyInputs: [".bearing/manifest.json", ".bearing/state"],
      unsafeInputs: [providerInput],
      recoveryChoices: [
        choice(
          "owner-repair",
          "matt-skills",
          1,
          "Repair the configured Matt contract through Matt's owning setup flow, then resume.",
          "The existing Matt contract only; no provider, driver, or native scope substitution.",
        ),
      ],
    });
  }
  if (provider !== undefined) {
    for (const surface of manifest.surfaces) {
      if (invalidSurfaces.has(surface)) continue;
      const locator = agentSurfaceEntryFile(surface);
      let matches = false;
      try {
        const source = (await readContainedFile(root, join(root, locator))).toString("utf8");
        matches = pointsToContract(source, provider.contractLocator);
      } catch {
        matches = false;
      }
      if (matches) continue;
      blockers.push({
        cause: "owner-dependency",
        impact: `Registered Agent Surface ${locator} does not point to the configured Matt contract.`,
        trustworthyInputs: [".bearing/manifest.json", ".bearing/provider.json", ".bearing/state"],
        unsafeInputs: [locator],
        recoveryChoices: [
          choice(
            "owner-repair",
            "agent-surface",
            1,
            `Repair ${locator} through its owning Agent Surface, then resume Setup revalidation.`,
            `${locator} only; the configured provider and canonical State remain unchanged.`,
          ),
        ],
      });
    }
  }

  for (const profile of manifest.executorProfiles) {
    const locator = `.bearing/executor-profiles/${profile}.md`;
    const state = await inspectInstallPath(join(root, locator));
    if (state.kind === "file" && state.linkCount === 1) continue;
    blockers.push({
      cause: "owner-dependency",
      impact: `Registered Execution Profile ${profile} is unavailable or unsafe.`,
      trustworthyInputs: [".bearing/manifest.json", ".bearing/state"],
      unsafeInputs: [locator],
      recoveryChoices: [
        choice(
          "owner-repair",
          "agent-surface",
          1,
          `Revalidate the nominated ${profile} skill or accept an explicit profile disposition.`,
          `${locator} and its explicitly nominated Agent Surface skill only.`,
        ),
      ],
    });
  }

  if (homeDir !== undefined) {
    try {
      const state = await readCatalogState({ homeDir });
      if (state.state === "ready") return blockers;
      const degraded = state.state === "degraded";
      blockers.push({
        cause: "catalog-conflict",
        impact: degraded
          ? "The Project Catalog is using a trustworthy backup instead of its current document."
          : "The Project Catalog has no trustworthy current or backup identity view.",
        trustworthyInputs: [
          ".bearing/manifest.json",
          ".bearing/state",
          ...(degraded ? ["$HOME/.bearing/catalog.backup.json"] : []),
        ],
        unsafeInputs: ["$HOME/.bearing/catalog.json"],
        recoveryChoices: [
          choice(
            "catalog-identity-repair",
            "bearing-setup",
            1,
            degraded
              ? "Repair the trustworthy Catalog backup through the explicit Catalog recovery flow."
              : "Explicitly confirm an empty Catalog reset or recover exact project identities through the Catalog owner.",
            "Project Catalog operational state only; repository bytes remain unchanged.",
          ),
        ],
      });
    } catch {
      blockers.push({
        cause: "catalog-conflict",
        impact: "The Project Catalog location is unsafe and has no usable identity view.",
        trustworthyInputs: [".bearing/manifest.json", ".bearing/state"],
        unsafeInputs: ["$HOME/.bearing/catalog.json"],
        recoveryChoices: [
          choice(
            "catalog-identity-repair",
            "bearing-setup",
            1,
            "Repair the Catalog location through its owner, then explicitly recover exact identities.",
            "Project Catalog operational state only; repository bytes remain unchanged.",
          ),
        ],
      });
    }
  }
  return blockers;
};

export const diagnoseRepositoryRecovery = async (
  unresolvedRoot: string,
  homeDir?: string,
): Promise<RepositoryRecoveryDiagnosis> => {
  const root = await resolveRepositoryRoot(unresolvedRoot);
  const namespace = join(root, ".bearing");
  const namespaceState = await inspectInstallPath(namespace);
  if (namespaceState.kind === "missing") {
    return { classification: "fresh", applied: false, blockers: [] };
  }
  if (namespaceState.kind !== "directory") {
    return {
      classification: "invalid-or-unsupported",
      applied: false,
      blockers: [
        {
          cause: "unsafe-namespace",
          impact: "No recovery mutation can safely identify its Bearing-owned targets.",
          trustworthyInputs: ["repository files outside `.bearing`"],
          unsafeInputs: [".bearing"],
          recoveryChoices: [],
        },
      ],
    };
  }

  const manifestPath = join(namespace, "manifest.json");
  const manifestState = await inspectInstallPath(manifestPath);
  let parsed: unknown;
  let envelopeCause: "missing-manifest" | "corrupt-manifest" | undefined;
  if (manifestState.kind === "missing") {
    envelopeCause = "missing-manifest";
  } else if (manifestState.kind !== "file" || manifestState.linkCount !== 1) {
    envelopeCause = "corrupt-manifest";
  } else {
    try {
      parsed = JSON.parse((await readContainedFile(root, manifestPath)).toString("utf8"));
    } catch {
      envelopeCause = "corrupt-manifest";
    }
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    typeof parsed.schemaVersion === "number" &&
    Number.isInteger(parsed.schemaVersion) &&
    parsed.schemaVersion > 1
  ) {
    return {
      classification: "invalid-or-unsupported",
      applied: false,
      blockers: [
        {
          cause: "newer-schema",
          impact: `Installed Bearing cannot interpret repository schema ${parsed.schemaVersion}.`,
          trustworthyInputs: [`manifest schema identity ${parsed.schemaVersion}`],
          unsafeInputs: [".bearing/manifest.json"],
          recoveryChoices: [
            choice(
              "compatible-kit",
              "package-manager",
              1,
              "Install a compatible newer Bearing kit, then resume validation.",
              "Global Bearing kit installation only; repository bytes remain read-only.",
            ),
          ],
        },
      ],
    };
  }

  const lifecycle = lifecycleManifestSchema.safeParse(parsed);
  if (lifecycle.success) {
    const invalidState = await invalidStateInputs(root);
    const dependencies = await dependencyBlockers(root, lifecycle.data, homeDir);
    const canonicalChoices = invalidState.length === 0 ? [] : await stateChoices(root, homeDir);
    if (invalidState.length === 0 && dependencies.length === 0) {
      return { classification: lifecycle.data.status, applied: false, blockers: [] };
    }
    return {
      classification: "invalid-or-unsupported",
      applied: false,
      blockers: [
        ...invalidState.map((diagnostic) => ({
          cause: "invalid-state-object" as const,
          impact: diagnostic.message,
          trustworthyInputs: [".bearing/manifest.json"],
          unsafeInputs: [diagnostic.target],
          recoveryChoices: canonicalChoices,
        })),
        ...dependencies,
      ],
    };
  }

  if (manifestSchema.safeParse(parsed).success) {
    return {
      classification: "legacy-cutover",
      applied: false,
      blockers: [
        {
          cause: "recognized-older-schema",
          impact: "The repository uses the recognized 0.1.0 integration envelope.",
          trustworthyInputs: [".bearing/manifest.json", ".bearing/state"],
          unsafeInputs: [],
          recoveryChoices: [
            choice(
              "bounded-cutover",
              "bearing-setup",
              1,
              "Inspect and consent to the bounded 0.1.0 to 0.1.1 cutover.",
              "Only the verified cutover plan after its durable Recovery Bundle is complete.",
            ),
          ],
        },
      ],
    };
  }

  const invalidState = await invalidStateInputs(root);
  const stateIsTrustworthy = invalidState.length === 0;
  const canonicalChoices = await stateChoices(root, homeDir);
  const envelopeChoices: readonly RepositoryRecoveryChoice[] = stateIsTrustworthy
    ? [
        choice(
          "rebuild-integration-envelope",
          "bearing-setup",
          1,
          "Back up the namespace and reconfirm surfaces, provider, and executor registrations.",
          "A new integration envelope around preserved, independently valid State.",
        ),
        ...canonicalChoices
          .filter((candidate) => candidate.kind === "restore-bundle" || candidate.kind === "purge")
          .map((candidate, index) => ({ ...candidate, order: index + 2 })),
      ]
    : canonicalChoices;
  return {
    classification: "invalid-or-unsupported",
    applied: false,
    blockers: [
      {
        cause: envelopeCause ?? "invalid-lifecycle-envelope",
        impact: "The manifest cannot authorize ordinary Setup or lifecycle operations.",
        trustworthyInputs: stateIsTrustworthy
          ? [".bearing/state", "repository files outside `.bearing`"]
          : ["repository files outside `.bearing`"],
        unsafeInputs: [".bearing/manifest.json"],
        recoveryChoices: envelopeChoices,
      },
      ...invalidState.map((diagnostic) => ({
        cause: "invalid-state-object" as const,
        impact: diagnostic.message,
        trustworthyInputs: ["repository files outside `.bearing`"],
        unsafeInputs: [diagnostic.target],
        recoveryChoices: canonicalChoices,
      })),
    ],
  };
};

type NamespaceItem = Readonly<{
  target: string;
  kind: "file" | "directory";
  identity: string;
  bytes?: number;
  sha256?: string;
  mode: number;
  bytesValue?: Buffer;
}>;

type ManagedBlockItem = Readonly<{
  surface: AgentSurface;
  target: string;
  blockSha256: string;
  blockBytes: number;
  filePrecondition: Readonly<{ sha256: string; bytes: number; mode: number }>;
  bytesValue: Buffer;
}>;

export type PurgePlan = Readonly<{
  canPurge: boolean;
  blockers: readonly string[];
  confirmationToken: string;
  inventory: Readonly<{
    namespace: readonly Omit<NamespaceItem, "bytesValue">[];
    managedBlocks: readonly Omit<ManagedBlockItem, "bytesValue" | "surface">[];
    catalogEntry?: Readonly<{ entryId: string; repoRoot: string; displayName: string }>;
  }>;
  recoveryExport: Readonly<{
    offered: true;
    requirement: "select-one-external-path-or-explicitly-accept-no-recovery";
  }>;
  irreversibleWithoutExport: readonly string[];
  preserved: readonly [
    "Matt-native work",
    "repository source and documentation",
    "external Asset payloads",
    "global Bearing kit",
  ];
}>;

export type PreparedPurge = Readonly<{
  root: string;
  plan: PurgePlan;
  namespace: readonly NamespaceItem[];
  managedBlocks: readonly ManagedBlockItem[];
  catalogEntry?: Readonly<{ entryId: string; repoRoot: string; displayName: string }>;
}>;

const inventoryNamespace = async (
  root: string,
  locator = ".bearing",
): Promise<readonly NamespaceItem[]> => {
  const target = join(root, locator);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Purge inspection found an unsafe Bearing-owned target: ${locator}`);
  }
  if (metadata.isFile()) {
    if (metadata.nlink !== 1) {
      throw new Error(`Purge inspection found an unsafe Bearing-owned target: ${locator}`);
    }
    const bytes = await readContainedFile(root, target);
    const after = await lstat(target);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.nlink !== 1 ||
      after.dev !== metadata.dev ||
      after.ino !== metadata.ino ||
      after.mode !== metadata.mode
    ) {
      throw new Error(`Purge inspection found a changed Bearing-owned target: ${locator}`);
    }
    return [
      {
        target: locator,
        kind: "file",
        identity: `${metadata.dev}:${metadata.ino}`,
        bytes: bytes.length,
        sha256: hash(bytes),
        mode: metadata.mode & 0o777,
        bytesValue: bytes,
      },
    ];
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Purge inspection found an unsafe Bearing-owned target: ${locator}`);
  }
  const items: NamespaceItem[] = [
    {
      target: locator,
      kind: "directory",
      identity: `${metadata.dev}:${metadata.ino}`,
      mode: metadata.mode & 0o777,
    },
  ];
  for (const child of (await readdir(target)).sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    items.push(...(await inventoryNamespace(root, posix.join(locator, child))));
  }
  const after = await lstat(target);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.dev !== metadata.dev ||
    after.ino !== metadata.ino ||
    after.mode !== metadata.mode
  ) {
    throw new Error(`Purge inspection found a changed Bearing-owned target: ${locator}`);
  }
  return items;
};

const inspectManagedBlock = async (
  root: string,
  surface: AgentSurface,
): Promise<ManagedBlockItem | undefined> => {
  const locator = agentSurfaceEntryFile(surface);
  const target = join(root, locator);
  const state = await inspectInstallPath(target);
  if (state.kind === "missing") return undefined;
  if (state.kind !== "file" || state.linkCount !== 1) {
    throw new Error(`Purge inspection found an unsafe Bearing-owned target: ${locator}`);
  }
  const bytes = await readContainedFile(root, target);
  let range: ReturnType<typeof bearingManagedRange>;
  try {
    range = bearingManagedRange(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Purge inspection found ambiguous managed-block ownership: ${locator}`, {
      cause: error,
    });
  }
  if (range === undefined) return undefined;
  const block = Buffer.from(bytes.toString("utf8").slice(range.start, range.end), "utf8");
  return {
    surface,
    target: `${locator}#bearing-managed-block`,
    blockSha256: hash(block),
    blockBytes: block.length,
    filePrecondition: {
      sha256: hash(bytes),
      bytes: bytes.length,
      mode: state.mode & 0o777,
    },
    bytesValue: block,
  };
};

const confirmationTokenFor = (
  root: string,
  namespace: readonly NamespaceItem[],
  managedBlocks: readonly ManagedBlockItem[],
  catalogEntry: PreparedPurge["catalogEntry"],
  blockers: readonly string[],
): string =>
  hash(
    Buffer.from(
      JSON.stringify({
        root,
        namespace: namespace.map(({ bytesValue: _bytesValue, ...item }) => item),
        managedBlocks: managedBlocks.map(
          ({ bytesValue: _bytesValue, surface: _surface, ...item }) => item,
        ),
        catalogEntry,
        blockers,
      }),
      "utf8",
    ),
  );

export const preparePurge = async (options: {
  repoRoot: string;
  homeDir: string;
}): Promise<PreparedPurge> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const namespace = await inventoryNamespace(root);
  const manifestItem = namespace.find((item) => item.target === ".bearing/manifest.json");
  let parsedManifest: unknown;
  if (manifestItem?.bytesValue !== undefined) {
    try {
      parsedManifest = JSON.parse(manifestItem.bytesValue.toString("utf8"));
    } catch {
      parsedManifest = undefined;
    }
  }
  const lifecycle = lifecycleManifestSchema.safeParse(parsedManifest);
  const legacy = manifestSchema.safeParse(parsedManifest);
  const newerSchema =
    typeof parsedManifest === "object" &&
    parsedManifest !== null &&
    "schemaVersion" in parsedManifest &&
    typeof parsedManifest.schemaVersion === "number" &&
    Number.isInteger(parsedManifest.schemaVersion) &&
    parsedManifest.schemaVersion > 1;
  const blockers: string[] = [
    ...(namespace[0]?.target === ".bearing" && namespace[0].kind !== "directory"
      ? ["The root `.bearing` namespace is not a directory and Purge fails closed."]
      : []),
    ...(newerSchema
      ? ["A newer repository schema must be handled by a compatible Bearing kit."]
      : []),
    ...(legacy.success && !lifecycle.success
      ? ["A recognized 0.1.0 repository must use its bounded cutover or compatible kit."]
      : []),
  ];
  const inspectedBlocks = (
    await Promise.all(
      (lifecycle.success ? lifecycle.data.surfaces : AGENT_SURFACES).map((surface) =>
        inspectManagedBlock(root, surface),
      ),
    )
  ).filter((item): item is ManagedBlockItem => item !== undefined);
  if (!lifecycle.success && inspectedBlocks.length > 0) {
    blockers.push(
      "The invalid lifecycle manifest cannot prove registration authority for discovered managed blocks; restore the envelope or accept an explicit per-surface disposition first.",
    );
  }
  const managedBlocks = lifecycle.success ? inspectedBlocks : [];
  let catalogEntry: PreparedPurge["catalogEntry"];
  try {
    const catalog = await readCatalogState({ homeDir: options.homeDir });
    if (catalog.state !== "ready") {
      blockers.push(
        catalog.state === "degraded"
          ? "The Project Catalog is degraded; repair its trustworthy backup before Purge."
          : "The Project Catalog requires owner repair before a matching-entry Purge inventory is trustworthy.",
      );
    } else {
      catalogEntry = catalog.document.entries.find((entry) => entry.repoRoot === root);
    }
  } catch {
    blockers.push(
      "The Project Catalog requires owner repair before a matching-entry Purge inventory is trustworthy.",
    );
  }
  const confirmationToken = confirmationTokenFor(
    root,
    namespace,
    managedBlocks,
    catalogEntry,
    blockers,
  );
  const plan: PurgePlan = Object.freeze({
    canPurge: blockers.length === 0,
    blockers: Object.freeze(blockers),
    confirmationToken,
    inventory: Object.freeze({
      namespace: Object.freeze(
        namespace.map(({ bytesValue: _bytesValue, ...item }) => Object.freeze(item)),
      ),
      managedBlocks: Object.freeze(
        managedBlocks.map(({ bytesValue: _bytesValue, surface: _surface, ...item }) =>
          Object.freeze(item),
        ),
      ),
      ...(catalogEntry === undefined ? {} : { catalogEntry: Object.freeze(catalogEntry) }),
    }),
    recoveryExport: Object.freeze({
      offered: true as const,
      requirement: "select-one-external-path-or-explicitly-accept-no-recovery" as const,
    }),
    irreversibleWithoutExport: Object.freeze([
      "canonical Bearing State and planning history",
      "repository-local Asset Registry relations",
      "project-owned Execution Profiles",
      "Pre-upgrade Recovery Bundles",
    ]),
    preserved: Object.freeze([
      "Matt-native work",
      "repository source and documentation",
      "external Asset payloads",
      "global Bearing kit",
    ] as const),
  });
  return {
    root,
    plan,
    namespace,
    managedBlocks,
    ...(catalogEntry === undefined ? {} : { catalogEntry }),
  };
};

export const inspectPurgePlan = async (options: {
  repoRoot: string;
  homeDir: string;
}): Promise<PurgePlan> => (await preparePurge(options)).plan;

export const assertPreparedPurgeCurrent = async (
  prepared: PreparedPurge,
  options: { repoRoot: string; homeDir: string },
): Promise<void> => {
  const current = await preparePurge(options);
  if (current.plan.confirmationToken !== prepared.plan.confirmationToken) {
    throw new Error("Repository purge generation changed after its exact inventory review.");
  }
};

export const assertPreparedPurgeNamespaceCurrent = async (
  prepared: PreparedPurge,
  options: { repoRoot: string; homeDir: string },
): Promise<void> => {
  const current = await preparePurge(options);
  if (
    JSON.stringify(current.plan.inventory.namespace) !==
      JSON.stringify(prepared.plan.inventory.namespace) ||
    JSON.stringify(current.plan.inventory.catalogEntry) !==
      JSON.stringify(prepared.plan.inventory.catalogEntry)
  ) {
    throw new Error("Repository Bearing namespace changed after its exact Purge review.");
  }
};

export const createPurgeRecoveryExport = async (
  prepared: PreparedPurge,
  unresolvedExportRoot: string,
): Promise<void> => {
  const exportRoot = resolve(unresolvedExportRoot);
  const namespaceRoot = join(prepared.root, ".bearing");
  const relativeToNamespace = relative(namespaceRoot, exportRoot);
  if (
    relativeToNamespace === "" ||
    (!relativeToNamespace.startsWith(`..${sep}`) && relativeToNamespace !== "..")
  ) {
    throw new Error("Purge recovery export must be outside the repository `.bearing` namespace.");
  }
  const parent = dirname(exportRoot);
  if (
    (await inspectInstallPath(parent)).kind !== "directory" ||
    (await inspectInstallPath(exportRoot)).kind !== "missing"
  ) {
    throw new Error(
      "Purge recovery export requires one missing target under an existing safe directory.",
    );
  }
  const canonicalParent = await realpath(parent);
  const canonicalExportRoot = join(canonicalParent, basename(exportRoot));
  const canonicalRelativeToNamespace = relative(namespaceRoot, canonicalExportRoot);
  if (
    canonicalRelativeToNamespace === "" ||
    (!canonicalRelativeToNamespace.startsWith(`..${sep}`) && canonicalRelativeToNamespace !== "..")
  ) {
    throw new Error("Purge recovery export must be outside the repository `.bearing` namespace.");
  }
  const inventory = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "bearing-purge-recovery-export",
        verified: true,
        sourcePlanToken: prepared.plan.confirmationToken,
        inventory: prepared.plan.inventory,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const plans: TargetPlan[] = [
    {
      target: join(canonicalExportRoot, "inventory.json"),
      bytes: inventory,
      executable: false,
    },
    ...prepared.namespace
      .filter(
        (item): item is NamespaceItem & Readonly<{ bytesValue: Buffer }> =>
          item.bytesValue !== undefined,
      )
      .map((item) => ({
        target: join(canonicalExportRoot, "repository", item.target),
        bytes: item.bytesValue,
        executable: false,
      })),
    ...prepared.managedBlocks.map((block) => ({
      target: join(
        canonicalExportRoot,
        "managed-blocks",
        `${agentSurfaceEntryFile(block.surface)}.block`,
      ),
      bytes: block.bytesValue,
      executable: false,
    })),
    ...(prepared.catalogEntry === undefined
      ? []
      : [
          {
            target: join(canonicalExportRoot, "catalog/entry.json"),
            bytes: Buffer.from(`${JSON.stringify(prepared.catalogEntry, null, 2)}\n`, "utf8"),
            executable: false,
          },
        ]),
  ];
  await applyInstallPlans(canonicalParent, plans, undefined, undefined, undefined, async () => {
    for (const plan of plans) {
      if (!("bytes" in plan)) continue;
      const current = await readContainedFile(canonicalParent, plan.target);
      if (!current.equals(plan.bytes)) {
        throw new Error(
          `Purge recovery export failed verification: ${relative(canonicalExportRoot, plan.target)}`,
        );
      }
    }
  });
};

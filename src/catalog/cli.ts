import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseCatalogEntryId } from "./entry-id";
import { CatalogEntryNotFoundError, CatalogRecoveryRequiredError } from "./errors";
import type { ProbedCatalogEntry } from "./model";
import { parseCatalogRepositoryRoot } from "./model";
import { readCatalog } from "./probe";
import type { CatalogEntryMutationResult, CatalogUnregisterResult } from "./store";
import {
  relinkCatalogEntry,
  renameCatalogEntry,
  resetCatalog,
  unregisterCatalogEntry,
} from "./store";

export const CATALOG_HELP = `Usage:
  bearing catalog inspect [--entry <entry-id> | --repo <path>]
  bearing catalog rename --entry <entry-id> --name <display-name>
  bearing catalog unregister (--entry <entry-id> | --repo <path>)
  bearing catalog relink --entry <entry-id> --repo <path> [--confirm-replace-location]
  bearing catalog reset --confirm-empty

Inspect is read-only. The other commands mutate only the user-level Project Catalog. Repository
lifecycle belongs to Repository Configuration. Relink replaces only a registered locator. Reset
publishes an empty schema; use Repository Configuration to register repositories again.
`;

export class CatalogCommandUsageError extends Error {
  readonly exitCode = 2;
  override readonly name = "CatalogCommandUsageError";
}

const requiredString = (value: string | undefined, option: string): string =>
  z.string().min(1, `${option} is required.`).parse(value);

const parseOptions = (
  args: readonly string[],
  options: Readonly<Record<string, Readonly<{ type: "string" | "boolean" }>>>,
): Readonly<Record<string, string | boolean | undefined>> => {
  try {
    return parseArgs({
      args: [...args],
      options,
      allowPositionals: false,
      strict: true,
    }).values;
  } catch (error) {
    throw new CatalogCommandUsageError(error instanceof Error ? error.message : String(error));
  }
};

const entryOutput = (result: CatalogEntryMutationResult): string =>
  `Outcome: ${result.outcome}\nEntry: ${result.entry.entryId}\nRepository: ${result.entry.repoRoot}\nDisplay name: ${result.entry.displayName}\n`;

const unregisterOutput = (result: CatalogUnregisterResult): string =>
  result.outcome === "applied"
    ? `Outcome: applied\nUnregistered entry: ${result.unregisteredEntry.entryId}\n`
    : "Outcome: no-op\n";

const inspectedEntryOutput = (entry: ProbedCatalogEntry): string =>
  `Entry: ${entry.entryId}\nRepository: ${entry.repoRoot}\nDisplay name: ${entry.displayName}\nAvailability: ${entry.availability}\n`;

type CatalogSelector =
  | Readonly<{ kind: "entry-id"; entryId: string }>
  | Readonly<{ kind: "repository-root"; repoRoot: string }>;

const selectEntry = (
  entries: readonly ProbedCatalogEntry[],
  selector: CatalogSelector | undefined,
): readonly ProbedCatalogEntry[] => {
  if (selector === undefined) return entries;
  if (selector.kind === "entry-id") {
    const entry = entries.find((candidate) => candidate.entryId === selector.entryId);
    if (entry === undefined) throw new CatalogEntryNotFoundError(selector.entryId);
    return [entry];
  }
  const entry = entries.find((candidate) => candidate.repoRoot === selector.repoRoot);
  if (entry === undefined) {
    throw new CatalogEntryNotFoundError(`repository root ${selector.repoRoot}`);
  }
  return [entry];
};

const selectorRepositoryRoot = async (value: string | undefined): Promise<string> => {
  const absoluteRoot = resolve(requiredString(value, "--repo"));
  try {
    return parseCatalogRepositoryRoot(await realpath(absoluteRoot));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return parseCatalogRepositoryRoot(absoluteRoot);
    }
    throw error;
  }
};

function parseSelector(
  values: Readonly<Record<string, string | boolean | undefined>>,
  required: true,
): Promise<CatalogSelector>;
function parseSelector(
  values: Readonly<Record<string, string | boolean | undefined>>,
  required: false,
): Promise<CatalogSelector | undefined>;
async function parseSelector(
  values: Readonly<Record<string, string | boolean | undefined>>,
  required: boolean,
): Promise<CatalogSelector | undefined> {
  const entry = values["entry"] as string | undefined;
  const repo = values["repo"] as string | undefined;
  if ((entry === undefined) === (repo === undefined)) {
    if (!required && entry === undefined) return undefined;
    throw new CatalogCommandUsageError("Use exactly one of --entry or --repo.");
  }
  if (entry !== undefined) return { kind: "entry-id", entryId: parseCatalogEntryId(entry) };
  return { kind: "repository-root", repoRoot: await selectorRepositoryRoot(repo) };
}

const runInspect = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const selector = await parseSelector(
    parseOptions(args, {
      entry: { type: "string" },
      repo: { type: "string" },
    }),
    false,
  );
  const catalog = await readCatalog({ homeDir });
  if (catalog.state === "failed") {
    throw new CatalogRecoveryRequiredError(catalog.diagnostic.message);
  }
  const entries = selectEntry(catalog.entries, selector);
  return `Outcome: ${catalog.state}\nEntries: ${entries.length}\n${entries.map(inspectedEntryOutput).join("")}`;
};

const runRename = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, {
    entry: { type: "string" },
    name: { type: "string" },
  });
  return entryOutput(
    await renameCatalogEntry({
      homeDir,
      entryId: requiredString(values["entry"] as string | undefined, "--entry"),
      displayName: requiredString(values["name"] as string | undefined, "--name"),
    }),
  );
};

const runUnregister = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const selector = await parseSelector(
    parseOptions(args, {
      entry: { type: "string" },
      repo: { type: "string" },
    }),
    true,
  );
  const result =
    selector.kind === "repository-root"
      ? await unregisterCatalogEntry({ homeDir, repoRoot: selector.repoRoot })
      : await unregisterCatalogEntry({ homeDir, entryId: selector.entryId });
  return unregisterOutput(result);
};

const runRelink = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, {
    entry: { type: "string" },
    repo: { type: "string" },
    "confirm-replace-location": { type: "boolean" },
  });
  return entryOutput(
    await relinkCatalogEntry({
      homeDir,
      entryId: requiredString(values["entry"] as string | undefined, "--entry"),
      newRepoRoot: resolve(requiredString(values["repo"] as string | undefined, "--repo")),
      confirmReplaceLocation: values["confirm-replace-location"] === true,
    }),
  );
};

const runReset = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, { "confirm-empty": { type: "boolean" } });
  if (values["confirm-empty"] !== true) {
    throw new CatalogCommandUsageError("Catalog reset requires --confirm-empty.");
  }
  const result = await resetCatalog({ homeDir, confirmed: true });
  return `Outcome: ${result.outcome}\n`;
};

const dispatchCatalogCommand = async (
  args: readonly string[],
  homeDir: string,
): Promise<string> => {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help" || command === "-h") return CATALOG_HELP;
  if (command === "inspect") return runInspect(homeDir, rest);
  if (command === "rename") return runRename(homeDir, rest);
  if (command === "unregister") return runUnregister(homeDir, rest);
  if (command === "relink") return runRelink(homeDir, rest);
  if (command === "reset") return runReset(homeDir, rest);
  throw new CatalogCommandUsageError("Unknown Catalog command. Run bearing catalog --help.");
};

export const runCatalogCommand = async (
  args: readonly string[],
  homeDir: string,
): Promise<string> => {
  try {
    return await dispatchCatalogCommand(args, homeDir);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CatalogCommandUsageError(error.issues[0]?.message ?? "Invalid Catalog input.");
    }
    throw error;
  }
};

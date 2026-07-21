import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { CatalogEntryMutationResult, CatalogRemovalResult } from "./store";
import {
  forgetCatalogEntry,
  relinkCatalogEntry,
  removeCatalogEntryByRepoRoot,
  renameCatalogEntry,
  repairCatalog,
  repairCatalogEntryLock,
  repairCatalogLock,
  resetCatalog,
} from "./store";

export const CATALOG_HELP = `Usage:
  bearing catalog rename --entry <entry-id> --name <display-name>
  bearing catalog forget --entry <entry-id>
  bearing catalog remove --repo <path>
  bearing catalog relink --entry <entry-id> --repo <path> [--confirm-move]
  bearing catalog repair
  bearing catalog repair-lock --confirm-abandoned
  bearing catalog repair-entry-lock --entry <entry-id> --confirm-abandoned
  bearing catalog reset --confirm-empty

Catalog commands mutate only the user-level Project Catalog. Repository lifecycle remains
orchestrated by bearing-setup. Repair restores a backup; repair-lock removes only a confirmed,
identity-revalidated abandoned lock. Relink never moves a repository, and reset never scans.
`;

const requiredString = (value: string | undefined, option: string): string =>
  z.string().min(1, `${option} is required.`).parse(value);

const parseOptions = (
  args: readonly string[],
  options: Readonly<Record<string, Readonly<{ type: "string" | "boolean" }>>>,
): Readonly<Record<string, string | boolean | undefined>> =>
  parseArgs({
    args: [...args],
    options,
    allowPositionals: false,
    strict: true,
  }).values;

const entryOutput = (result: CatalogEntryMutationResult): string =>
  `Outcome: ${result.outcome}\nEntry: ${result.entry.entryId}\nRepository: ${result.entry.repoRoot}\nDisplay name: ${result.entry.displayName}\n`;

const removalOutput = (result: CatalogRemovalResult): string =>
  result.outcome === "applied"
    ? `Outcome: applied\nRemoved entry: ${result.removedEntry.entryId}\n`
    : "Outcome: no-op\n";

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

const runForget = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, { entry: { type: "string" } });
  return removalOutput(
    await forgetCatalogEntry({
      homeDir,
      entryId: requiredString(values["entry"] as string | undefined, "--entry"),
    }),
  );
};

const runRemove = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, { repo: { type: "string" } });
  return removalOutput(
    await removeCatalogEntryByRepoRoot({
      homeDir,
      repoRoot: resolve(requiredString(values["repo"] as string | undefined, "--repo")),
    }),
  );
};

const runRelink = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, {
    entry: { type: "string" },
    repo: { type: "string" },
    "confirm-move": { type: "boolean" },
  });
  return entryOutput(
    await relinkCatalogEntry({
      homeDir,
      entryId: requiredString(values["entry"] as string | undefined, "--entry"),
      newRepoRoot: resolve(requiredString(values["repo"] as string | undefined, "--repo")),
      confirmMove: values["confirm-move"] === true,
    }),
  );
};

const runRepair = async (homeDir: string, args: readonly string[]): Promise<string> => {
  parseOptions(args, {});
  const result = await repairCatalog({ homeDir });
  return `Outcome: ${result.outcome}\n`;
};

const runReset = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, { "confirm-empty": { type: "boolean" } });
  if (values["confirm-empty"] !== true) {
    throw new Error("Catalog reset requires --confirm-empty.");
  }
  const result = await resetCatalog({ homeDir, confirmed: true });
  return `Outcome: ${result.outcome}\n`;
};

const runRepairLock = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, { "confirm-abandoned": { type: "boolean" } });
  if (values["confirm-abandoned"] !== true) {
    throw new Error("Catalog lock repair requires --confirm-abandoned.");
  }
  const result = await repairCatalogLock({ homeDir, confirmed: true });
  return `Outcome: ${result.outcome}\n`;
};

const runRepairEntryLock = async (homeDir: string, args: readonly string[]): Promise<string> => {
  const values = parseOptions(args, {
    entry: { type: "string" },
    "confirm-abandoned": { type: "boolean" },
  });
  if (values["confirm-abandoned"] !== true) {
    throw new Error("Catalog entry lock repair requires --confirm-abandoned.");
  }
  const result = await repairCatalogEntryLock({
    homeDir,
    entryId: requiredString(values["entry"] as string | undefined, "--entry"),
    confirmed: true,
  });
  return `Outcome: ${result.outcome}\n`;
};

export const runCatalogCommand = async (
  args: readonly string[],
  homeDir: string,
): Promise<string> => {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help" || command === "-h") return CATALOG_HELP;
  if (command === "rename") return runRename(homeDir, rest);
  if (command === "forget") return runForget(homeDir, rest);
  if (command === "remove") return runRemove(homeDir, rest);
  if (command === "relink") return runRelink(homeDir, rest);
  if (command === "repair") return runRepair(homeDir, rest);
  if (command === "repair-lock") return runRepairLock(homeDir, rest);
  if (command === "repair-entry-lock") return runRepairEntryLock(homeDir, rest);
  if (command === "reset") return runReset(homeDir, rest);
  throw new Error("Unknown Catalog command. Run bearing catalog --help.");
};

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { z } from "zod";

const fail = (message: string): never => {
  throw new Error(message);
};

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const artifactSchema = z
  .object({
    path: z.string().min(1),
    file: z.string().min(1),
    sha256: sha256Schema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (!isAbsolute(artifact.path) || basename(artifact.path) !== artifact.file) {
      context.addIssue({
        code: "custom",
        message: "Matrix package artifact requires an absolute path with its exact file name.",
      });
    }
  });

const releaseCandidatePackageSchema = z
  .object({
    evidenceClass: z.literal("release-candidate"),
    packageName: z.literal("@lagrangee/bearing"),
    packageVersion: z.string().min(1),
    sourceCommit: z.string().min(1),
    workflow: z
      .object({
        name: z.string().min(1),
        runId: z.string().min(1),
        runAttempt: z.number().int().positive(),
      })
      .strict(),
    artifact: artifactSchema,
    matrixDefinitionSha256: sha256Schema,
  })
  .strict();

const localRehearsalPackageSchema = z
  .object({
    evidenceClass: z.literal("local-rehearsal"),
    packageName: z.literal("@lagrangee/bearing"),
    packageVersion: z.string().min(1),
    sourceHead: z.string().min(1),
    worktreeSha256: sha256Schema,
    artifact: artifactSchema,
    matrixDefinitionSha256: sha256Schema,
  })
  .strict();

export const liveScenarioPackageSchema = z.discriminatedUnion("evidenceClass", [
  releaseCandidatePackageSchema,
  localRehearsalPackageSchema,
]);
export type LiveScenarioPackage = z.infer<typeof liveScenarioPackageSchema>;

const candidateReceiptBindingSchema = z
  .object({
    path: z.string().min(1),
    sha256: sha256Schema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (!isAbsolute(binding.path)) {
      context.addIssue({ code: "custom", message: "Candidate Receipt path must be absolute." });
    }
  });

const liveScenarioPackageBasisSchema = z.discriminatedUnion("evidenceClass", [
  releaseCandidatePackageSchema.extend({
    schemaVersion: z.literal(1),
    candidateReceipt: candidateReceiptBindingSchema,
  }),
  localRehearsalPackageSchema.extend({ schemaVersion: z.literal(1) }),
]);
export type LiveScenarioPackageBasis = z.infer<typeof liveScenarioPackageBasisSchema>;

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

export const writeLiveScenarioPackageBasis = async (
  path: string,
  value: unknown,
): Promise<LiveScenarioPackageBasis> => {
  const basis = liveScenarioPackageBasisSchema.parse(value);
  const bytes = `${JSON.stringify(basis, null, 2)}\n`;
  await writeFile(path, bytes, { flag: "wx" });
  await writeFile(`${path}.sha256`, `${sha256(bytes)}\n`, { flag: "wx" });
  return basis;
};

export const readLiveScenarioPackageBasis = async (
  path: string,
): Promise<LiveScenarioPackageBasis> => {
  const bytes = await readFile(path, "utf8");
  if ((await readFile(`${path}.sha256`, "utf8")).trim() !== sha256(bytes)) {
    fail("Live Scenario package basis digest mismatch.");
  }
  return liveScenarioPackageBasisSchema.parse(JSON.parse(bytes));
};

const requiredGitleaksVersion = "8.30.1";

export const scanLiveScenarioDurableEvidence = (input: {
  value: unknown;
  configPath: string;
  program?: string;
}): string => {
  const bytes = `${JSON.stringify(input.value, null, 2)}\n`;
  const program = input.program ?? "gitleaks";
  const version = Bun.spawnSync([program, "version"], { stdout: "pipe", stderr: "pipe" });
  if (version.exitCode !== 0 || version.stdout.toString().trim() !== requiredGitleaksVersion) {
    fail(`Durable Matrix evidence requires Gitleaks ${requiredGitleaksVersion}.`);
  }
  const scan = Bun.spawnSync(
    [program, "stdin", "--config", input.configPath, "--no-banner", "--no-color", "--redact"],
    { stdin: Buffer.from(bytes, "utf8"), stdout: "pipe", stderr: "pipe" },
  );
  if (scan.exitCode !== 0) {
    fail("Durable Live Scenario evidence failed the required Gitleaks scan.");
  }
  return bytes;
};

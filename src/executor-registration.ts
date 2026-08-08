import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { parseMarkdownEnvelope } from "./markdown-document";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import { repositoryManifestSchema } from "./schema-definitions";
import type { AgentSurface, ExecutorRegistration } from "./types";

const skillNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const capabilityLocatorSchema = z
  .string()
  .regex(/^(agent-skills|claude):([a-z0-9]+(?:-[a-z0-9]+)*)$/u);
const localExecutionReferenceSchema = z
  .string()
  .min(1)
  .refine(
    (locator) =>
      !locator.includes("\0") &&
      !locator.includes("\\") &&
      !isAbsolute(locator) &&
      !/^[a-z][a-z0-9+.-]*:/iu.test(locator) &&
      locator.toLowerCase().endsWith(".md"),
    { message: "Execution-contract references must be local relative Markdown paths." },
  );
const skillContractHeaderSchema = z.object({
  name: skillNameSchema,
  description: z.string().min(1),
});
const semanticEvidenceSchema = z
  .string()
  .min(1)
  .refine((evidence) => evidence.trim() === evidence && !evidence.includes("\0"), {
    message: "Semantic evidence must be one exact non-empty source excerpt.",
  });
const profileProseSchema = z
  .string()
  .min(1)
  .refine(
    (prose) => prose.trim() === prose && !/[\0\r\n]/u.test(prose) && !/[`*_#<>[\]]/u.test(prose),
    { message: "Execution Profile prose must be one plain-text line." },
  );
export const executorNominationAssessmentSchema = z.strictObject({
  capabilityLocator: capabilityLocatorSchema,
  conclusion: z.literal("owns-end-to-end-execution-and-final-writeback"),
  requiredReferences: z
    .array(localExecutionReferenceSchema)
    .refine((references) => new Set(references).size === references.length, {
      message: "Required execution-contract references must be unique.",
    }),
  executionOwnershipEvidence: semanticEvidenceSchema,
  finalWritebackEvidence: semanticEvidenceSchema,
  nativeArtifacts: z
    .array(
      z.strictObject({
        description: profileProseSchema,
        evidence: semanticEvidenceSchema,
      }),
    )
    .min(1),
  writebackBehavior: z.strictObject({
    description: profileProseSchema,
    evidence: semanticEvidenceSchema,
  }),
});
export type ExecutorNominationAssessment = z.infer<typeof executorNominationAssessmentSchema>;
const storedExecutionProfileHeaderSchema = z.object({
  Type: z.literal("execution-profile"),
  Version: z.literal(1),
  "Profile key": skillNameSchema,
  "Display name": z.string().regex(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  "Agent surface": z.enum(["agent-skills", "claude"]),
  "Capability locator": capabilityLocatorSchema,
});
const requiredExecutionProfileSections = [
  "Native Artifacts",
  "Writeback Behavior",
  "Durable Evidence",
  "Fallback Receipt",
  "Asset Admission",
] as const;
export const executorRegistrationSchema = z
  .strictObject({
    profileKey: skillNameSchema,
    displayName: z.string().regex(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    surface: z.enum(["agent-skills", "claude"]),
    capabilityLocator: capabilityLocatorSchema,
    nativeArtifacts: z.array(z.string().min(1)).min(1),
    writebackBehavior: z.string().min(1),
    assessment: executorNominationAssessmentSchema,
    sourceContractSnapshot: z.string().min(1),
  })
  .superRefine((registration, context) => {
    const separator = registration.capabilityLocator.indexOf(":");
    const locatorSurface = registration.capabilityLocator.slice(0, separator);
    const skillName = registration.capabilityLocator.slice(separator + 1);
    if (
      locatorSurface !== registration.surface ||
      registration.profileKey !== `${registration.surface}-${skillName}` ||
      registration.displayName !== `/${skillName}` ||
      registration.assessment.capabilityLocator !== registration.capabilityLocator
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Executor Registration identity must match its surface-qualified capability locator.",
      });
    }
  });

const surfaceRoot = (homeDir: string, surface: AgentSurface): string =>
  join(homeDir, surface === "agent-skills" ? ".agents/skills" : ".claude/skills");

export const resolveExecutorNomination = async (
  homeDir: string,
  capabilityLocator: string,
  rawAssessment?: ExecutorNominationAssessment,
): Promise<ExecutorRegistration> => {
  const locator = capabilityLocatorSchema.parse(capabilityLocator);
  const separator = locator.indexOf(":");
  const surface = locator.slice(0, separator) as AgentSurface;
  const skillName = skillNameSchema.parse(locator.slice(separator + 1));
  const canonicalHome = await resolveRepositoryRoot(homeDir);
  const skillDirectory = join(surfaceRoot(canonicalHome, surface), skillName);
  let source: string;
  try {
    source = (await readContainedFile(canonicalHome, join(skillDirectory, "SKILL.md"))).toString(
      "utf8",
    );
  } catch (error) {
    throw new Error(`Nominated executor skill is unavailable: ${capabilityLocator}`, {
      cause: error,
    });
  }
  const parsed = parseMarkdownEnvelope(source);
  if (!parsed.ok) {
    throw new Error(`Nominated executor skill contract is malformed: ${capabilityLocator}`);
  }
  const header = skillContractHeaderSchema.safeParse(parsed.data);
  if (!header.success || header.data.name !== skillName) {
    throw new Error(`Nominated executor skill identity does not match: ${capabilityLocator}`);
  }
  if (rawAssessment === undefined) {
    throw new Error(
      `Nominated executor skill requires an explicit Agent Surface semantic assessment: ${capabilityLocator}`,
    );
  }
  const assessment = executorNominationAssessmentSchema.parse(rawAssessment);
  if (assessment.capabilityLocator !== locator) {
    throw new Error(`Executor semantic assessment identity does not match: ${capabilityLocator}`);
  }
  const referenceContracts: Array<{ locator: string; source: string }> = [];
  const canonicalSkillDirectory = await resolveRepositoryRoot(skillDirectory);
  const referenceBoundary = dirname(canonicalSkillDirectory);
  for (const reference of assessment.requiredReferences) {
    if (!source.includes(reference)) {
      throw new Error(
        `Executor semantic assessment cites an undeclared local contract reference: ${capabilityLocator}:${reference}`,
      );
    }
    try {
      referenceContracts.push({
        locator: reference,
        source: (
          await readContainedFile(referenceBoundary, resolve(canonicalSkillDirectory, reference))
        ).toString("utf8"),
      });
    } catch (error) {
      throw new Error(
        `Nominated executor skill required contract is unavailable: ${capabilityLocator}:${reference}`,
        { cause: error },
      );
    }
  }
  const contract = `${header.data.description}\n${parsed.body}\n${referenceContracts
    .map((reference) => reference.source)
    .join("\n")}`;
  const sourceContractSnapshot = JSON.stringify({
    skillContract: source,
    requiredReferences: referenceContracts,
  });
  const evidence = [
    assessment.executionOwnershipEvidence,
    assessment.finalWritebackEvidence,
    ...assessment.nativeArtifacts.map((artifact) => artifact.evidence),
    assessment.writebackBehavior.evidence,
  ];
  if (evidence.some((excerpt) => !contract.includes(excerpt))) {
    throw new Error(
      `Executor semantic assessment cites text outside the nominated skill contract: ${capabilityLocator}`,
    );
  }
  return Object.freeze(
    executorRegistrationSchema.parse({
      profileKey: `${surface}-${skillName}`,
      displayName: `/${header.data.name}`,
      surface,
      capabilityLocator: locator,
      nativeArtifacts: assessment.nativeArtifacts.map((artifact) => artifact.description),
      writebackBehavior: assessment.writebackBehavior.description,
      assessment,
      sourceContractSnapshot,
    }),
  );
};

export type ExecutorWritebackSelection = Readonly<{
  capabilityLocator: string;
  profileKey: string;
  matchedRegistration: boolean;
  reconciliationScope: "execution-evidence-only";
  authorizesNativeTerminalWriteback: false;
  profileContract: Readonly<{
    version: 1;
    body: string;
  }>;
  disclosure?: string;
}>;

export const readConfiguredExecutionProfiles = async (
  repoRoot: string,
  surfaces: readonly AgentSurface[],
  profileKeys: readonly string[],
): Promise<
  readonly Readonly<{ profileKey: string; capabilityLocator: string; body: string }>[]
> => {
  const root = await resolveRepositoryRoot(repoRoot);
  const configuredProfiles: Array<{
    profileKey: string;
    capabilityLocator: string;
    body: string;
  }> = [];
  for (const profileKey of profileKeys) {
    const profilePath = join(root, ".bearing/executor-profiles", `${profileKey}.md`);
    let parsed: ReturnType<typeof parseMarkdownEnvelope>;
    try {
      parsed = parseMarkdownEnvelope((await readContainedFile(root, profilePath)).toString("utf8"));
    } catch (error) {
      throw new Error(`Configured Execution Profile is unavailable: ${profileKey}`, {
        cause: error,
      });
    }
    if (!parsed.ok) {
      throw new Error(`Configured Execution Profile is malformed: ${profileKey}`);
    }
    const header = storedExecutionProfileHeaderSchema.safeParse(parsed.data);
    const headerLocator = header.success ? header.data["Capability locator"] : undefined;
    const separator = headerLocator?.indexOf(":") ?? -1;
    const locatorSurface = headerLocator?.slice(0, separator);
    const skillName = headerLocator?.slice(separator + 1);
    if (
      !header.success ||
      header.data["Profile key"] !== profileKey ||
      locatorSurface !== header.data["Agent surface"] ||
      profileKey !== `${locatorSurface}-${skillName}` ||
      header.data["Display name"] !== `/${skillName}` ||
      !surfaces.includes(header.data["Agent surface"]) ||
      requiredExecutionProfileSections.some((section) => !parsed.body.includes(`## ${section}\n`))
    ) {
      throw new Error(`Configured Execution Profile identity is invalid: ${profileKey}`);
    }
    configuredProfiles.push({
      profileKey,
      capabilityLocator: header.data["Capability locator"],
      body: parsed.body,
    });
  }
  return Object.freeze(configuredProfiles.map((profile) => Object.freeze(profile)));
};

export const resolveExecutorWritebackProfile = async (
  repoRoot: string,
  actualCapabilityLocator: string,
): Promise<ExecutorWritebackSelection> => {
  const capabilityLocator = capabilityLocatorSchema.parse(actualCapabilityLocator);
  const root = await resolveRepositoryRoot(repoRoot);
  const manifest = repositoryManifestSchema.parse(
    JSON.parse(
      (await readContainedFile(root, join(root, ".bearing/manifest.json"))).toString("utf8"),
    ),
  );
  if (manifest.status !== "active") {
    throw new Error("Executor writeback requires an active Bearing repository.");
  }
  const configuredProfiles = await readConfiguredExecutionProfiles(
    root,
    manifest.surfaces,
    manifest.executorProfiles,
  );
  const matched = configuredProfiles.find(
    (profile) => profile.capabilityLocator === capabilityLocator,
  );
  if (matched !== undefined) {
    return Object.freeze({
      capabilityLocator,
      profileKey: matched.profileKey,
      matchedRegistration: true,
      reconciliationScope: "execution-evidence-only",
      authorizesNativeTerminalWriteback: false,
      profileContract: {
        version: 1 as const,
        body: matched.body,
      },
    });
  }
  return Object.freeze({
    capabilityLocator,
    profileKey: "generic-agent",
    matchedRegistration: false,
    reconciliationScope: "execution-evidence-only",
    authorizesNativeTerminalWriteback: false,
    profileContract: {
      version: 1 as const,
      body: "package-owned:generic-agent/v1; reconciliation-scope=execution-evidence-only; native-terminal-authority=none",
    },
    disclosure:
      "No specialized Executor Registration matched; the package-owned Generic Agent contract governed evidence reconciliation only and grants no native Ticket lifecycle authority.",
  });
};

export const assertExecutorWritebackSelectionCurrent = async (
  repoRoot: string,
  expected: ExecutorWritebackSelection,
): Promise<void> => {
  const current = await resolveExecutorWritebackProfile(repoRoot, expected.capabilityLocator);
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(
      "Executor Registration matching changed during durable writeback; provenance was not committed.",
    );
  }
};

export const resolveExecutorNominations = async (
  homeDir: string,
  capabilityLocators: readonly string[],
  rawAssessments: readonly ExecutorNominationAssessment[] = [],
): Promise<readonly ExecutorRegistration[]> => {
  const unique = [...new Set(capabilityLocators)];
  const assessments = rawAssessments.map((assessment) =>
    executorNominationAssessmentSchema.parse(assessment),
  );
  if (
    assessments.length !== unique.length ||
    new Set(assessments.map((assessment) => assessment.capabilityLocator)).size !==
      assessments.length ||
    assessments.some((assessment) => !unique.includes(assessment.capabilityLocator))
  ) {
    throw new Error(
      "Executor semantic assessments must match the nominated capability locators exactly.",
    );
  }
  return Object.freeze(
    await Promise.all(
      unique.map((locator) =>
        resolveExecutorNomination(
          homeDir,
          locator,
          assessments.find((assessment) => assessment.capabilityLocator === locator),
        ),
      ),
    ),
  );
};

export const validateExecutorRegistrationSelection = (
  registrations: readonly ExecutorRegistration[],
  surfaces: readonly AgentSurface[],
  profiles: readonly string[],
): readonly ExecutorRegistration[] => {
  const parsed = registrations.map((registration) =>
    executorRegistrationSchema.parse(registration),
  );
  const profileKeys = parsed.map((registration) => registration.profileKey);
  if (
    new Set(profileKeys).size !== profileKeys.length ||
    JSON.stringify([...profileKeys].sort()) !== JSON.stringify([...profiles].sort())
  ) {
    throw new Error("Fresh Execution Profiles must match the accepted Executor Registrations.");
  }
  for (const registration of parsed) {
    if (!surfaces.includes(registration.surface)) {
      throw new Error(
        `Executor Registration surface is not selected: ${registration.capabilityLocator}`,
      );
    }
  }
  return Object.freeze(parsed.map((registration) => Object.freeze(registration)));
};

export const assertExecutorRegistrationsCurrent = async (
  homeDir: string,
  expected: readonly ExecutorRegistration[],
): Promise<void> => {
  const current = await resolveExecutorNominations(
    homeDir,
    expected.map((registration) => registration.capabilityLocator),
    expected.map((registration) =>
      executorNominationAssessmentSchema.parse(registration.assessment),
    ),
  );
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(
      "Nominated executor skill contract changed after Repository Configuration review.",
    );
  }
};

type ExecutionProfileDefinition = Pick<
  ExecutorRegistration,
  | "profileKey"
  | "displayName"
  | "surface"
  | "capabilityLocator"
  | "nativeArtifacts"
  | "writebackBehavior"
>;

export const renderExecutionProfile = (registration: ExecutionProfileDefinition): Buffer =>
  Buffer.from(
    `---
Type: execution-profile
Version: 1
Profile key: ${registration.profileKey}
Display name: ${registration.displayName}
Agent surface: ${registration.surface}
Capability locator: ${registration.capabilityLocator}
---

# Execution Profile: ${registration.displayName}

## Native Artifacts

${registration.nativeArtifacts.map((artifact) => `- ${artifact}`).join("\n")}

## Writeback Behavior

${registration.writebackBehavior}

## Durable Evidence

Use only durable repository artifacts or stable native execution outputs that substantiate the outcome. Conversational claims and transient command output are not durable evidence.

## Fallback Receipt

Create \`.scratch/<slug>/evidence/<work-item>-${registration.profileKey}.md\` when the execution leaves no durable outcome and verification record. Record Work item, Execution profile, Outcome, Verification, and Produced artifacts.

## Asset Admission

Do not register execution output as an Asset automatically. If an output has continuing planning value or is a first-class durable project artifact, return it to the initiating Agent for an explicit Asset admission decision. Ordinary source changes, commits, receipts, and verification evidence remain execution outputs, not Assets.
`,
    "utf8",
  );

import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import {
  ARCHITECTURE_CONTRACTION_BUDGETS,
  ARCHITECTURE_CONTRACTION_METHOD,
  type ArchitectureContractionCandidateEvidence,
  assertArchitectureContractionCandidateEvidence,
} from "../scripts/architecture-contraction-candidate-contract";
import { projectProviderEvidenceBindingKey } from "../src/project-read-model/store";
import { createRepresentativeProject } from "./fixtures/representative-project";
import { installPackedProduct } from "./product-seams/installed-product";

const candidate = {
  sourceCommit: "a".repeat(40),
  packageFile: "lagrangee-bearing-0.1.0.tgz",
  packageSha256: "b".repeat(64),
} as const;

const validEvidence = (): ArchitectureContractionCandidateEvidence => ({
  schemaVersion: 1 as const,
  evidenceKind: "architecture-contraction-candidate" as const,
  candidate,
  packageAttestation: {
    regeneratedPackageSha256: candidate.packageSha256,
    exactSourcePackageMatch: true,
    installedPackageSha256: candidate.packageSha256,
    installMode: "offline",
    installedCliObserved: true,
  },
  fixture: {
    baselineDigest: "sha256:c8f3d7e2dd616163a1dc38856ba15f94c09362440a6baa838e1b1f11827774c8",
    candidateDigest: "sha256:3e8643369f6d7dd9952dd19cccd580d210f242f0e173861d8e754f6673c91c16",
    managedInputCount: 36,
    bearingRecordCount: 30,
    providerScopeCount: 9,
    baselineTotalBytes: 26_311,
    candidateTotalBytes: 26_319,
    comparability:
      "Same generated topology; clean-cut wording replaced the historical Sync benchmark phrase (+8 bytes).",
  },
  methodology: ARCHITECTURE_CONTRACTION_METHOD,
  measurements: {
    typedInspectQueryP95Ms: 10,
    typedPortalQueryP95Ms: 10,
    unchangedManagedBasisP95Ms: 20,
    unchangedProviderAcquisitionCount: 0,
    unchangedPublicationCount: 0,
    unchangedReadModelMutationCount: 0,
    semanticRematerializationP95Ms: 30,
    semanticRematerializationPeakRssBytes: 128 * 1024 * 1024,
    semanticTransactionCount: 100,
    semanticPublicationCount: 100,
    providerInitialAcquisitionCount: 9,
    ordinaryRematerializationAcquisitionCount: 0,
    retainedFootprint: {
      fileCount: 1,
      totalBytes: 1000,
      observationFileCount: 0,
      observationBytes: 0,
    },
    lastGoodPreservedAfterFailedCommit: true,
    mixedGenerationObserved: false,
    catalogBytesChanged: false,
  },
  lanes: [
    { name: "sqlite-performance", candidate, outcome: "passed" as const },
    { name: "packed-journey", candidate, outcome: "passed" as const },
    {
      name: "fresh-agent",
      candidate,
      outcome: "passed" as const,
      details: {
        runtime: {
          codexCliVersion: "codex-cli 1.2.3",
          model: "gpt-5.6-luna",
          reasoningEffort: "high",
          mode: "codex-exec",
          realInvocationStarted: true,
          terminalBoundaryReached: true,
        },
      },
    },
    { name: "foreground-portal", candidate, outcome: "passed" as const },
  ],
  authority: {
    concludesEffort: false,
    changesGateReadiness: false,
    passesGate: false,
    claimsReleaseProof: false,
  },
});

describe("Architecture Contraction candidate evidence", () => {
  test("fixes the accepted Ticket 04 method and budgets", () => {
    expect(ARCHITECTURE_CONTRACTION_METHOD).toEqual({
      warmupCount: 20,
      sampleCount: 100,
      p95: "nearest-rank",
      changePattern: "alternate-project-summary-a-b",
    });
    expect(ARCHITECTURE_CONTRACTION_BUDGETS).toEqual({
      typedQueryP95Ms: 100,
      unchangedManagedBasisP95Ms: 500,
      semanticRematerializationP95Ms: 5000,
      semanticRematerializationPeakRssBytes: 512 * 1024 * 1024,
    });
  });

  test("uses one SQLite-safe provider binding identity", () => {
    const key = projectProviderEvidenceBindingKey({
      provider: "matt-skills/v1",
      nativeScope: ".scratch/work",
    });
    expect(key).not.toContain("\0");
    expect(key).toBe("6d6174742d736b696c6c732f7631002e736372617463682f776f726b");
  });

  test("the packed Node CLI reopens provider binding identity after a changed-basis publication", async () => {
    const product = await installPackedProduct();
    const fixture = await createRepresentativeProject("representative", product.root);
    try {
      expect(
        (
          await product.run(["cache", "rebuild", "--repo", "."], {
            cwd: fixture.root,
            observeRoots: [fixture.root],
          })
        ).exitClass,
      ).toBe("success");
      expect(
        (
          await product.run(["provider", "verify", "--all", "--repo", "."], {
            cwd: fixture.root,
            observeRoots: [fixture.root],
          })
        ).exitClass,
      ).toBe("success");
      expect(
        (
          await product.run(["inspect", "project", "--repo", "."], {
            cwd: fixture.root,
            observeRoots: [fixture.root],
          })
        ).exitClass,
      ).toBe("success");
      for (const args of [
        ["git", "init", "-q"],
        ["git", "config", "user.name", "Candidate Fixture"],
        ["git", "config", "user.email", "candidate@example.invalid"],
        ["git", "add", "-A"],
        ["git", "commit", "-qm", "fixture: candidate reopen"],
      ]) {
        expect(await Bun.spawn(args, { cwd: fixture.root }).exited).toBe(0);
      }

      const summaryPath = `${fixture.root}/${fixture.summaryLocator}`;
      await writeFile(
        summaryPath,
        (await readFile(summaryPath, "utf8")).replace(
          "variant A",
          "variant B after an exact changed-basis publication",
        ),
      );
      expect(
        (
          await product.run(["inspect", "project", "--repo", "."], {
            cwd: fixture.root,
            observeRoots: [fixture.root],
          })
        ).exitClass,
      ).toBe("success");
      const reopened = await product.run(["inspect", "diagnostics", "--repo", "."], {
        cwd: fixture.root,
        observeRoots: [fixture.root],
      });
      expect(reopened.exitClass).toBe("success");
      expect(JSON.parse(reopened.stdout)).toMatchObject({ outcome: "complete", diagnostics: [] });
    } finally {
      await product.dispose();
    }
  }, 60_000);

  test("accepts one exact candidate and rejects mixed identity or weakened proof", () => {
    expect(assertArchitectureContractionCandidateEvidence(validEvidence())).toEqual(
      validEvidence(),
    );

    const mixed = {
      ...validEvidence(),
      lanes: validEvidence().lanes.map((lane) =>
        lane.name === "fresh-agent"
          ? { ...lane, candidate: { ...candidate, packageSha256: "c".repeat(64) } }
          : lane,
      ),
    };
    expect(() => assertArchitectureContractionCandidateEvidence(mixed)).toThrow(
      "same exact candidate",
    );

    const slow = {
      ...validEvidence(),
      measurements: { ...validEvidence().measurements, semanticRematerializationP95Ms: 5000 },
    };
    expect(() => assertArchitectureContractionCandidateEvidence(slow)).toThrow(
      "semantic rematerialization p95",
    );

    const hiddenPublication = {
      ...validEvidence(),
      measurements: { ...validEvidence().measurements, unchangedPublicationCount: 1 },
    };
    expect(() => assertArchitectureContractionCandidateEvidence(hiddenPublication)).toThrow(
      "unchanged managed basis",
    );

    const hiddenProviderAcquisition = {
      ...validEvidence(),
      measurements: {
        ...validEvidence().measurements,
        ordinaryRematerializationAcquisitionCount: 1,
      },
    };
    expect(() => assertArchitectureContractionCandidateEvidence(hiddenProviderAcquisition)).toThrow(
      "provider acquisition",
    );

    const unattestedPackage = {
      ...validEvidence(),
      packageAttestation: {
        regeneratedPackageSha256: "c".repeat(64),
        exactSourcePackageMatch: false,
        installedPackageSha256: candidate.packageSha256,
        installMode: "offline",
        installedCliObserved: true,
      },
    } as unknown as ArchitectureContractionCandidateEvidence;
    expect(() => assertArchitectureContractionCandidateEvidence(unattestedPackage)).toThrow(
      "source package attestation",
    );

    const incompleteFreshAgent = {
      ...validEvidence(),
      lanes: validEvidence().lanes.map((lane) =>
        lane.name === "fresh-agent"
          ? {
              ...lane,
              details: {
                runtime: {
                  codexCliVersion: "codex-cli 1.2.3",
                  model: "gpt-5.6-luna",
                  reasoningEffort: "high",
                  mode: "codex-exec",
                  realInvocationStarted: true,
                  terminalBoundaryReached: false,
                },
              },
            }
          : lane,
      ),
    } as unknown as ArchitectureContractionCandidateEvidence;
    expect(() => assertArchitectureContractionCandidateEvidence(incompleteFreshAgent)).toThrow(
      "Fresh Agent runtime",
    );

    const passageClaim = {
      ...validEvidence(),
      authority: { ...validEvidence().authority, passesGate: true },
    };
    expect(() => assertArchitectureContractionCandidateEvidence(passageClaim)).toThrow(
      "human lifecycle",
    );
  });
});

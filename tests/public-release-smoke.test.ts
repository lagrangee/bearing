import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LivePublicReleaseSurfaces,
  loadPublicReleaseCandidate,
  type PublicReleaseCandidate,
  type PublicReleaseObservation,
  type PublicReleaseSurfaces,
  parsePublicReleaseSmokeArgs,
  publicEntryRoutes,
  readPublicRelease,
} from "../scripts/public-release-smoke";
import { requiredPackagePaths } from "../scripts/release-boundary";
import {
  type CandidateManifest,
  type CandidateReceipt,
  releaseCandidateId,
  serializeCandidateJson,
  sha256Bytes,
} from "../scripts/release-candidate-lib";
import { writeTarGzFixture } from "./release-archive-fixture";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const candidate: PublicReleaseCandidate = {
  packageName: "@lagrangee/bearing",
  packageVersion: "0.1.1",
  sourceCommit: "a".repeat(40),
  workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
  artifact: {
    sha256: "b".repeat(64),
    npmShasum: "c".repeat(40),
    npmIntegrity: "sha512-frozen",
  },
  releaseTag: "v0.1.1",
  releaseTitle: "@lagrangee/bearing 0.1.1",
  releaseNotes: "Frozen release notes.\n",
  releaseAssets: [
    { name: "lagrangee-bearing-0.1.1.tgz", size: 3, sha256: "1".repeat(64) },
    { name: "candidate-receipt.json", size: 4, sha256: "2".repeat(64) },
    { name: "candidate-manifest.json", size: 5, sha256: "3".repeat(64) },
    { name: "release-notes.md", size: 6, sha256: "4".repeat(64) },
  ],
};

const available = <T>(value: T) => ({ kind: "available", value }) as const;
const availableValue = <T>(observation: { kind: "available"; value: T } | { kind: string }): T => {
  if (observation.kind !== "available" || !("value" in observation)) {
    throw new Error("fixture observation is not available");
  }
  return observation.value as T;
};

const makeCandidateReceipt = async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-public-release-smoke-"));
  temporaryRoots.push(root);
  const packageFiles: Record<string, string> = Object.fromEntries(
    requiredPackagePaths.map((path) => [path, `fixture for ${path}\n`]),
  );
  packageFiles["package.json"] = `${JSON.stringify({
    name: candidate.packageName,
    version: candidate.packageVersion,
  })}\n`;
  packageFiles["dist/extra.js"] = "export {};\n";
  const artifactPath = join(root, `lagrangee-bearing-${candidate.packageVersion}.tgz`);
  await writeTarGzFixture(
    artifactPath,
    Object.entries(packageFiles).map(([path, bytes]) => ({
      path: `package/${path}`,
      bytes,
      mode: 0o644,
    })),
  );
  const manifest: CandidateManifest = {
    schemaVersion: 2,
    packageName: candidate.packageName,
    packageVersion: candidate.packageVersion,
    sourceCommit: candidate.sourceCommit,
    files: Object.entries(packageFiles)
      .map(([path, bytes]) => ({ path, size: Buffer.byteLength(bytes), mode: 0o644 }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
  const manifestText = serializeCandidateJson(manifest);
  const manifestPath = join(root, "candidate-manifest.json");
  const notesPath = join(root, "release-notes.md");
  await Promise.all([
    writeFile(manifestPath, manifestText),
    writeFile(notesPath, candidate.releaseNotes),
  ]);
  const artifact = await readFile(artifactPath);
  const artifactSha256 = sha256Bytes(artifact);
  const receipt: CandidateReceipt = {
    schemaVersion: 2,
    packageName: candidate.packageName,
    packageVersion: candidate.packageVersion,
    sourceCommit: candidate.sourceCommit,
    candidateId: releaseCandidateId(
      candidate.packageName,
      candidate.packageVersion,
      candidate.sourceCommit,
      artifactSha256,
      candidate.workflow.runId,
      candidate.workflow.runAttempt,
    ),
    workflow: candidate.workflow,
    toolchain: { node: "v24.15.0", bun: "1.3.8", npm: "11.11.0" },
    artifact: {
      file: `lagrangee-bearing-${candidate.packageVersion}.tgz`,
      size: artifact.byteLength,
      sha256: artifactSha256,
      npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
      npmShasum: createHash("sha1").update(artifact).digest("hex"),
    },
    manifest: { file: "candidate-manifest.json", sha256: sha256Bytes(Buffer.from(manifestText)) },
    releaseNotes: {
      file: "release-notes.md",
      sha256: sha256Bytes(Buffer.from(candidate.releaseNotes)),
    },
  };
  const receiptPath = join(root, "candidate-receipt.json");
  await writeFile(receiptPath, serializeCandidateJson(receipt));
  return { receipt, receiptPath };
};

const entryRoutes = publicEntryRoutes(candidate);
const exactReadmeRoute = `https://raw.githubusercontent.com/lagrangee/bearing/${candidate.sourceCommit}/README.md`;
const exactReadmeBody = `# Bearing

[Agent installation guide](docs/agent-installation.md)

The demo is a static sample, not a hosted Bearing project, real repository, canonical planning surface, or proof of product value.
Use [Q&A](${entryRoutes.questions}) or [Ideas](${entryRoutes.ideas}). Use GitHub private vulnerability reporting.
`;

const exactObservation: PublicReleaseObservation = {
  npm: available({
    name: candidate.packageName,
    version: candidate.packageVersion,
    shasum: candidate.artifact.npmShasum,
    integrity: candidate.artifact.npmIntegrity,
    provenanceUrl: "https://registry.npmjs.org/-/npm/v1/attestations/@lagrangee%2fbearing@0.1.1",
    provenancePredicateType: "https://slsa.dev/provenance/v1",
    provenance: {
      subjectName: "pkg:npm/%40lagrangee/bearing@0.1.1",
      subjectSha512: Buffer.from("frozen", "base64").toString("hex"),
      sourceCommit: candidate.sourceCommit,
      workflowRepository: "https://github.com/lagrangee/bearing",
      workflowPath: ".github/workflows/publish.yml",
      invocationId: "https://github.com/lagrangee/bearing/actions/runs/654321/attempts/1",
      invocationSourceCommit: candidate.sourceCommit,
      invocationWorkflowPath: ".github/workflows/publish.yml",
      invocationRunAttempt: 1,
      invocationConclusion: "failure",
    },
  }),
  tag: available({ tag: candidate.releaseTag, targetCommit: candidate.sourceCommit }),
  release: available({
    tag: candidate.releaseTag,
    title: candidate.releaseTitle,
    notes: candidate.releaseNotes,
    draft: false,
    prerelease: false,
    assets: candidate.releaseAssets,
  }),
  pages: available({
    status: "success",
    deploymentSourceCommit: "a".repeat(40),
    workflowSourceCommit: "a".repeat(40),
    workflowRunId: 888,
    workflowPath: ".github/workflows/demo-pages.yml",
    workflowEvent: "workflow_dispatch",
    workflowConclusion: "success",
    artifactSourceCommit: candidate.sourceCommit,
  }),
  entries: {
    readme: available({
      finalUrl: entryRoutes.readme,
      body: exactReadmeBody,
    }),
    agentInstallation: available({
      finalUrl: entryRoutes.agentInstallation,
      body: "Use the published package with your Skill Directory and stop before repository setup",
    }),
    demo: available({
      finalUrl: entryRoutes.demo,
      body: "Fixed-data static sample · Not a hosted Bearing project · Not a real repository · Not proof of product value · It does not pass a Gate · Suspected vulnerabilities stay private · Community support is best-effort",
    }),
    bugReport: available({ finalUrl: entryRoutes.bugReport, body: "Bug report" }),
    documentationReport: available({
      finalUrl: entryRoutes.documentationReport,
      body: "Documentation problem",
    }),
    questions: available({ finalUrl: entryRoutes.questions, body: "Q&A" }),
    ideas: available({ finalUrl: entryRoutes.ideas, body: "Ideas" }),
    vulnerabilityReport: available({
      finalUrl: entryRoutes.vulnerabilityReport,
      body: "Privately report a security vulnerability",
    }),
  },
};

class FakePublicReleaseSurfaces implements PublicReleaseSurfaces {
  readonly calls: string[] = [];

  constructor(private readonly observation: PublicReleaseObservation) {}

  async inspect(): Promise<PublicReleaseObservation> {
    this.calls.push("inspect");
    return structuredClone(this.observation);
  }
}

test("reads one exact public release without claiming Publication or Gate outcomes", async () => {
  const surfaces = new FakePublicReleaseSurfaces(exactObservation);

  await expect(readPublicRelease(candidate, surfaces)).resolves.toEqual({
    outcome: "passed",
    candidate: {
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
      sourceCommit: candidate.sourceCommit,
      workflow: candidate.workflow,
      frozenSha256: candidate.artifact.sha256,
    },
    publicPrefix: "npm+tag+release+pages+user-entry",
    checks: {
      npm: "exact",
      tag: "exact",
      release: "exact",
      pages: "exact",
      userEntry: "exact",
    },
    resumptionPoint: null,
    authority: {
      publicationSuccess: false,
      effortConclusion: false,
      gatePassage: false,
      staticDemoDoesNotEstablish: ["hosted-product", "real-repository", "gate-proof"],
    },
  });
  expect(surfaces.calls).toEqual(["inspect"]);
});

test("reports the exact monotonic public prefix when a later identity is absent", async () => {
  const entries = Object.fromEntries(
    Object.keys(exactObservation.entries).map((name) => [name, { kind: "absent" }]),
  ) as PublicReleaseObservation["entries"];
  const observation: PublicReleaseObservation = {
    ...exactObservation,
    tag: { kind: "absent" },
    release: { kind: "absent" },
    pages: { kind: "absent" },
    entries,
  };

  const result = await readPublicRelease(candidate, new FakePublicReleaseSurfaces(observation));

  expect(result).toMatchObject({
    outcome: "incomplete",
    publicPrefix: "npm",
    checks: {
      npm: "exact",
      tag: "absent",
      release: "absent",
      pages: "absent",
      userEntry: "absent",
    },
    resumptionPoint: "tag",
  });
});

test("reports the exact wrong user route without changing the valid public prefix", async () => {
  const routes = publicEntryRoutes(candidate);
  const ideas = availableValue(exactObservation.entries.ideas);
  const observation: PublicReleaseObservation = {
    ...exactObservation,
    entries: {
      ...exactObservation.entries,
      ideas: available({ ...ideas, finalUrl: routes.questions }),
    },
  };

  const result = await readPublicRelease(candidate, new FakePublicReleaseSurfaces(observation));

  expect(result).toMatchObject({
    outcome: "incomplete",
    publicPrefix: "npm+tag+release+pages",
    checks: { userEntry: "wrong-route" },
    resumptionPoint: "user-entry:ideas",
  });
});

test("requires complete immutable Candidate input and has no mutable latest selector", () => {
  const parsed = parsePublicReleaseSmokeArgs([
    "--candidate-receipt",
    "/tmp/candidate-receipt.json",
    "--version",
    candidate.packageVersion,
    "--source-commit",
    candidate.sourceCommit,
    "--workflow-name",
    candidate.workflow.name,
    "--workflow-run-id",
    candidate.workflow.runId,
    "--workflow-run-attempt",
    String(candidate.workflow.runAttempt),
    "--frozen-sha256",
    candidate.artifact.sha256,
  ]);

  expect(parsed).toEqual({
    candidateReceipt: "/tmp/candidate-receipt.json",
    version: candidate.packageVersion,
    sourceCommit: candidate.sourceCommit,
    workflowName: candidate.workflow.name,
    workflowRunId: candidate.workflow.runId,
    workflowRunAttempt: candidate.workflow.runAttempt,
    frozenSha256: candidate.artifact.sha256,
  });
  expect(() => parsePublicReleaseSmokeArgs(["--candidate-receipt", "/tmp/receipt.json"])).toThrow(
    "missing --version",
  );
  expect(JSON.stringify(parsed)).not.toContain("latest");
});

test("loads public identity and required Release assets from one verified Candidate Receipt", async () => {
  const fixture = await makeCandidateReceipt();
  const options = {
    candidateReceipt: fixture.receiptPath,
    version: fixture.receipt.packageVersion,
    sourceCommit: fixture.receipt.sourceCommit,
    workflowName: fixture.receipt.workflow.name,
    workflowRunId: fixture.receipt.workflow.runId,
    workflowRunAttempt: fixture.receipt.workflow.runAttempt,
    frozenSha256: fixture.receipt.artifact.sha256,
  };

  const loaded = await loadPublicReleaseCandidate(options);

  expect(loaded).toMatchObject({
    packageName: fixture.receipt.packageName,
    packageVersion: fixture.receipt.packageVersion,
    sourceCommit: fixture.receipt.sourceCommit,
    workflow: fixture.receipt.workflow,
    artifact: {
      sha256: fixture.receipt.artifact.sha256,
      npmShasum: fixture.receipt.artifact.npmShasum,
      npmIntegrity: fixture.receipt.artifact.npmIntegrity,
    },
    releaseTag: `v${fixture.receipt.packageVersion}`,
    releaseTitle: `${fixture.receipt.packageName} ${fixture.receipt.packageVersion}`,
    releaseNotes: candidate.releaseNotes,
  });
  expect(loaded.releaseAssets.map((asset) => asset.name).sort()).toEqual(
    [
      fixture.receipt.artifact.file,
      "candidate-receipt.json",
      fixture.receipt.manifest.file,
      fixture.receipt.releaseNotes.file,
    ].sort(),
  );
  await expect(
    loadPublicReleaseCandidate({ ...options, frozenSha256: "f".repeat(64) }),
  ).rejects.toThrow("frozen digest does not match the Candidate Receipt");
});

test("live surfaces use only exact-version read-only requests", async () => {
  const requests: {
    url: string;
    method?: string;
    accept: string | null;
    authorization: string | null;
  }[] = [];
  let readmeBody = exactReadmeBody;
  const demoModuleRoute = `${entryRoutes.demo}assets/index-Candidate.js`;
  let demoShell =
    '<script type="module" crossorigin src="/bearing/assets/index-Candidate.js"></script>';
  let invocationSourceCommit = candidate.sourceCommit;
  const pagesWorkflowSourceCommit = "a".repeat(40);
  let pagesRunSourceCommit = pagesWorkflowSourceCommit;
  let pagesWorkflowPath = ".github/workflows/demo-pages.yml";
  let pagesDeployments: readonly { readonly id: number; readonly sha: string }[] = [
    { id: 777, sha: pagesWorkflowSourceCommit },
  ];
  let pagesStatuses: readonly { readonly state: string; readonly log_url: string }[] = [
    {
      state: "success",
      log_url: "https://github.com/lagrangee/bearing/actions/runs/888/job/999",
    },
  ];
  let pagesArtifactName = `github-pages-${candidate.sourceCommit}`;
  const response = (url: string, value: unknown, body = "public entry") =>
    ({
      ok: true,
      status: 200,
      url,
      json: async () => value,
      text: async () => body,
    }) as Response;
  const fetchFixture = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      ...(init?.method === undefined ? {} : { method: init.method }),
      accept: headers.get("Accept"),
      authorization: headers.get("Authorization"),
    });
    if (url === availableValue(exactObservation.npm).provenanceUrl) {
      const provenance = availableValue(exactObservation.npm).provenance;
      const statement = {
        subject: [{ name: provenance.subjectName, digest: { sha512: provenance.subjectSha512 } }],
        predicate: {
          buildDefinition: {
            externalParameters: {
              workflow: {
                repository: provenance.workflowRepository,
                path: provenance.workflowPath,
              },
            },
            resolvedDependencies: [{ digest: { gitCommit: provenance.sourceCommit } }],
          },
          runDetails: { metadata: { invocationId: provenance.invocationId } },
        },
      };
      return response(url, {
        attestations: [
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: {
              dsseEnvelope: {
                payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
              },
            },
          },
        ],
      });
    }
    if (url.includes("registry.npmjs.org")) {
      return response(url, {
        name: candidate.packageName,
        version: candidate.packageVersion,
        dist: {
          shasum: candidate.artifact.npmShasum,
          integrity: candidate.artifact.npmIntegrity,
          attestations: {
            url: availableValue(exactObservation.npm).provenanceUrl,
            provenance: {
              predicateType: availableValue(exactObservation.npm).provenancePredicateType,
            },
          },
        },
      });
    }
    if (url.endsWith("/actions/runs/654321/attempts/1")) {
      return response(url, {
        head_sha: invocationSourceCommit,
        path: ".github/workflows/publish.yml",
        run_attempt: 1,
        conclusion: "failure",
      });
    }
    if (url.endsWith(`/git/ref/tags/${candidate.releaseTag}`)) {
      return response(url, {
        ref: `refs/tags/${candidate.releaseTag}`,
        object: { type: "commit", sha: candidate.sourceCommit },
      });
    }
    if (url.endsWith(`/releases/tags/${candidate.releaseTag}`)) {
      return response(url, {
        tag_name: candidate.releaseTag,
        name: candidate.releaseTitle,
        body: candidate.releaseNotes,
        draft: false,
        prerelease: false,
        assets: candidate.releaseAssets.map((asset) => ({
          name: asset.name,
          size: asset.size,
          digest: `sha256:${asset.sha256}`,
        })),
      });
    }
    if (url.endsWith("/deployments?environment=github-pages&per_page=1")) {
      return response(url, pagesDeployments);
    }
    if (url.endsWith("/deployments/777/statuses?per_page=1")) {
      return response(url, pagesStatuses);
    }
    if (url.endsWith("/actions/runs/888")) {
      return response(url, {
        id: 888,
        head_sha: pagesRunSourceCommit,
        path: pagesWorkflowPath,
        event: "workflow_dispatch",
        conclusion: "success",
      });
    }
    if (url.endsWith("/actions/runs/888/artifacts?per_page=100")) {
      return response(url, {
        artifacts: [
          {
            name: pagesArtifactName,
            expired: false,
            workflow_run: { id: 888, head_sha: pagesRunSourceCommit },
          },
        ],
      });
    }
    if (url === entryRoutes.readme) {
      return response(url, {}, "canonical public repository page");
    }
    if (url === exactReadmeRoute) {
      return response(url, {}, readmeBody);
    }
    if (url === entryRoutes.agentInstallation) {
      return response(url, {}, availableValue(exactObservation.entries.agentInstallation).body);
    }
    if (url === entryRoutes.demo) return response(url, {}, demoShell);
    if (url === demoModuleRoute) {
      return response(url, {}, availableValue(exactObservation.entries.demo).body);
    }
    const entry = Object.values(exactObservation.entries).find(
      (observation) => availableValue(observation).finalUrl === url,
    );
    return response(url, {}, entry === undefined ? "public entry" : availableValue(entry).body);
  }) as typeof fetch;

  const result = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture, githubToken: "fixture-token" }),
  );

  expect(result.outcome).toBe("passed");
  expect(
    requests.every((request) => request.method === undefined || request.method === "GET"),
  ).toBe(true);
  expect(requests.map((request) => request.url)).toContain(
    `https://registry.npmjs.org/@lagrangee%2fbearing/${candidate.packageVersion}`,
  );
  expect(requests.map((request) => request.url)).toContain(
    availableValue(exactObservation.npm).provenanceUrl ?? "",
  );
  expect(requests.map((request) => request.url)).toContain(exactReadmeRoute);
  expect(requests.map((request) => request.url)).toContain(entryRoutes.agentInstallation);
  expect(requests.map((request) => request.url)).toContain(
    "https://api.github.com/repos/lagrangee/bearing/deployments?environment=github-pages&per_page=1",
  );
  expect(requests.map((request) => request.url)).toContain(
    "https://api.github.com/repos/lagrangee/bearing/deployments/777/statuses?per_page=1",
  );
  expect(requests.map((request) => request.url)).toContain(
    "https://api.github.com/repos/lagrangee/bearing/actions/runs/888",
  );
  expect(requests.map((request) => request.url)).toContain(
    "https://api.github.com/repos/lagrangee/bearing/actions/runs/888/artifacts?per_page=100",
  );
  expect(requests.map((request) => request.url)).toContain(
    "https://api.github.com/repos/lagrangee/bearing/actions/runs/654321/attempts/1",
  );
  for (const request of requests.filter(({ url }) =>
    url.startsWith("https://registry.npmjs.org/"),
  )) {
    expect(request.accept).toBe("application/json");
    expect(request.authorization).toBeNull();
  }
  for (const request of requests.filter(({ url }) => url.startsWith("https://api.github.com/"))) {
    expect(request.accept).toBe("application/vnd.github+json");
    expect(request.authorization).toBe("Bearer fixture-token");
  }
  expect(JSON.stringify(requests)).not.toMatch(
    /@latest|npm install|playwright|codex|claude|workbuddy/iu,
  );

  invocationSourceCommit = "f".repeat(40);
  const wrongInvocation = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(wrongInvocation).toMatchObject({
    outcome: "incomplete",
    checks: { npm: "conflicting" },
    resumptionPoint: "npm",
  });
  invocationSourceCommit = candidate.sourceCommit;

  readmeBody = exactReadmeBody.replace("docs/agent-installation.md", "docs/data-and-security.md");
  const wrongReadmeLink = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(wrongReadmeLink).toMatchObject({
    outcome: "incomplete",
    checks: { userEntry: "wrong-route" },
    resumptionPoint: "user-entry:agentInstallation",
  });

  readmeBody = exactReadmeBody;
  demoShell = '<!-- <script src="./mock-data.js" type="module"></script> -->';
  const unloadedDisclosure = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(unloadedDisclosure).toMatchObject({
    outcome: "incomplete",
    checks: { userEntry: "unverifiable" },
    resumptionPoint: "user-entry:demo",
  });

  demoShell =
    '<script type="module" crossorigin src="/bearing/assets/index-Candidate.js"></script>';
  pagesStatuses = [
    {
      state: "failure",
      log_url: "https://github.com/lagrangee/bearing/actions/runs/888/job/999",
    },
  ];
  const failedPagesDeployment = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(failedPagesDeployment).toMatchObject({
    outcome: "incomplete",
    checks: { pages: "conflicting" },
    resumptionPoint: "pages",
  });

  pagesStatuses = [
    {
      state: "success",
      log_url: "https://github.com/lagrangee/bearing/actions/runs/888/job/999",
    },
  ];
  pagesArtifactName = `github-pages-${"f".repeat(40)}`;
  const wrongPagesSource = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(wrongPagesSource).toMatchObject({
    outcome: "incomplete",
    checks: { pages: "conflicting" },
    resumptionPoint: "pages",
  });

  pagesArtifactName = `github-pages-${candidate.sourceCommit}`;
  pagesRunSourceCommit = "f".repeat(40);
  const wrongPagesWorkflow = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(wrongPagesWorkflow).toMatchObject({
    outcome: "incomplete",
    checks: { pages: "conflicting" },
    resumptionPoint: "pages",
  });

  pagesRunSourceCommit = pagesWorkflowSourceCommit;
  pagesWorkflowPath = ".github/workflows/ci.yml";
  const wrongPagesWorkflowOwner = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(wrongPagesWorkflowOwner).toMatchObject({
    outcome: "incomplete",
    checks: { pages: "conflicting" },
    resumptionPoint: "pages",
  });

  pagesWorkflowPath = ".github/workflows/demo-pages.yml";
  pagesDeployments = [{ id: 777, sha: pagesWorkflowSourceCommit }];
  pagesStatuses = [];
  const missingPagesStatus = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(missingPagesStatus).toMatchObject({
    outcome: "incomplete",
    checks: { pages: "unverifiable" },
    resumptionPoint: "pages",
  });

  pagesDeployments = [];
  const absentPagesDeployment = await readPublicRelease(
    candidate,
    new LivePublicReleaseSurfaces({ fetch: fetchFixture }),
  );
  expect(absentPagesDeployment).toMatchObject({
    outcome: "incomplete",
    checks: { pages: "absent" },
    resumptionPoint: "pages",
  });
});

test("preserves conflicting, unverifiable, and network-failed public prefixes", async () => {
  const scenarios: readonly {
    observation(): PublicReleaseObservation;
    expected: Readonly<{
      publicPrefix: string;
      check: Partial<{
        npm: string;
        tag: string;
        release: string;
        pages: string;
        userEntry: string;
      }>;
      resumptionPoint: string;
    }>;
  }[] = [
    {
      observation: () => ({
        ...exactObservation,
        npm: available({ ...availableValue(exactObservation.npm), shasum: "f".repeat(40) }),
      }),
      expected: { publicPrefix: "none", check: { npm: "conflicting" }, resumptionPoint: "npm" },
    },
    {
      observation: () => ({
        ...exactObservation,
        npm: available({
          ...availableValue(exactObservation.npm),
          provenance: {
            ...availableValue(exactObservation.npm).provenance,
            sourceCommit: "f".repeat(40),
          },
        }),
      }),
      expected: { publicPrefix: "none", check: { npm: "conflicting" }, resumptionPoint: "npm" },
    },
    {
      observation: () => ({
        ...exactObservation,
        tag: { kind: "unverifiable", reason: "fixture permission denied" },
      }),
      expected: {
        publicPrefix: "npm",
        check: { tag: "unverifiable" },
        resumptionPoint: "tag",
      },
    },
    {
      observation: () => ({
        ...exactObservation,
        entries: {
          ...exactObservation.entries,
          questions: { kind: "unverifiable", reason: "fixture network failed" },
        },
      }),
      expected: {
        publicPrefix: "npm+tag+release+pages",
        check: { userEntry: "unverifiable" },
        resumptionPoint: "user-entry:questions",
      },
    },
    {
      observation: () => ({
        ...exactObservation,
        entries: {
          ...exactObservation.entries,
          demo: available({
            ...availableValue(exactObservation.entries.demo),
            body: "A reachable page without the sample disclosure",
          }),
        },
      }),
      expected: {
        publicPrefix: "npm+tag+release+pages",
        check: { userEntry: "conflicting" },
        resumptionPoint: "user-entry:demo",
      },
    },
    {
      observation: () => ({
        ...exactObservation,
        entries: {
          ...exactObservation.entries,
          demo: available({
            ...availableValue(exactObservation.entries.demo),
            body: `${availableValue(exactObservation.entries.demo).body} This is a real repository and is proof of product value.`,
          }),
        },
      }),
      expected: {
        publicPrefix: "npm+tag+release+pages",
        check: { userEntry: "conflicting" },
        resumptionPoint: "user-entry:demo",
      },
    },
  ];

  for (const scenario of scenarios) {
    const result = await readPublicRelease(
      candidate,
      new FakePublicReleaseSurfaces(scenario.observation()),
    );
    expect(result).toMatchObject({
      outcome: "incomplete",
      publicPrefix: scenario.expected.publicPrefix,
      checks: scenario.expected.check,
      resumptionPoint: scenario.expected.resumptionPoint,
    });
  }
});

test("exposes one reusable public readback command through the release runbook", async () => {
  const [packageJson, runbook, source] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("docs/agents/release-live-journey.md", "utf8"),
    readFile("scripts/public-release-smoke.ts", "utf8"),
  ]);
  const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

  expect(scripts["release:public-smoke"]).toBe("bun scripts/public-release-smoke.ts");
  expect(runbook).toContain("bun run release:public-smoke -- --candidate-receipt");
  expect(runbook).toMatch(
    /--version[\s\S]*--source-commit[\s\S]*--workflow-name[\s\S]*--workflow-run-id[\s\S]*--workflow-run-attempt[\s\S]*--frozen-sha256/u,
  );
  expect(source).toContain("if (import.meta.main)");
  expect(source).not.toMatch(
    /npm\s+(?:install|publish)|playwright|codex\s+exec|claude|workbuddy/iu,
  );
});

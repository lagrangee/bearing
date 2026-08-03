import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import {
  type PlanningLineageSubject,
  planningLineageSubjectHref,
} from "../src/planning-lineage-route";
import type { ProjectSnapshot, ProjectSnapshotInput } from "../src/project-snapshot/contract";
import { buildMattNativeSourceRecords } from "../src/project-snapshot/native-work-sources";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github";
import { mattNativeScopeSubject } from "../src/providers/matt-skills-v1/native-subject";
import { createMattReferenceProjection } from "../tests/fixtures/matt-reference-scenario";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import {
  parseRebuiltPlanningLineageFixture,
  withRebuiltPlanningLineage,
} from "../tests/planning-lineage-fixture";
import {
  type RunningTestPortal,
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
} from "./real-host-test-support";

const entryId = "g3-comprehension";

const projectView = (snapshot: ProjectSnapshot) => ({
  project: { entryId, displayName: "G3 Comprehension Project", availability: "available" },
  cache: {
    snapshot: { state: "available", snapshot },
    receipt: {
      schemaVersion: 1,
      producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
      completedAt: "2026-07-31T10:00:00+08:00",
      sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
      reconciliation: "no-op",
    },
    retained: false,
  },
  diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
});

const readyEnvelope = (snapshot: ProjectSnapshot) => ({
  version: 1,
  state: "ready",
  view: projectView(snapshot),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
  session: { csrfToken: "ticket-24-csrf" },
});

const forcedEnvelope = (snapshot: ProjectSnapshot) => ({
  version: 1,
  state: "completed",
  mode: "force",
  outcome: "applied",
  reconciliation: "applied",
  snapshotDisposition: "materialized",
  view: projectView(snapshot),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

const withPreviewAsset = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.assets.validity !== "available") throw new Error("Expected readable Assets.");
  const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:fixture-uncited" },
    fragment: "asset:fixture-uncited",
  });
  const candidate = {
    ...snapshot,
    assets: {
      validity: "available" as const,
      items: [
        ...snapshot.assets.items,
        {
          id: "asset:fixture-uncited",
          title: "Uncited Fixture Evidence",
          source: source.reference,
          evidenceRoles: [],
          citations: [],
          authorityAdoptions: [],
          passageEvidence: [],
          kind: "verification-report",
          owner: "effort:portal",
          producer: { kind: "executor-profile", name: "generic-agent" },
          lifecycleSource: "native",
          registeredAt: { availability: "unavailable" },
          displayLocation: "evidence/uncited.md",
          contentAvailability: "available",
        },
      ],
    },
    sources: [...snapshot.sources, source],
  };
  return projectSnapshotSchema.parse(withRebuiltPlanningLineage(candidate as ProjectSnapshotInput));
};

const localSnapshot = (): ProjectSnapshot => {
  const snapshot = withPreviewAsset(createProjectOverviewFixture());
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets.");
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) =>
        asset.id === "asset:fixture-uncited"
          ? {
              ...asset,
              owner: ".scratch/portal/issues/02-review.md",
              producedFor: ".scratch/portal/issues/01-build.md",
            }
          : asset,
      ),
    },
  });
};

const githubScenarioSnapshot = (): Readonly<{
  snapshot: ProjectSnapshot;
  nativeScope: PlanningLineageSubject;
  nativeSubject: PlanningLineageSubject;
  nativeScopeTitle: string;
  nativeSubjectTitle: string;
}> => {
  const base = createProjectOverviewFixture();
  if (base.efforts.validity !== "available") throw new Error("Expected readable Efforts.");
  const nativeScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "reference",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: "issue",
      number: 101,
      databaseId: "9101",
      nodeId: "I_reference_1",
    },
  });
  const observation = createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding: { provider: "matt-skills/v1", nativeScope },
    observedAt: "2026-07-31T10:00:00.000Z",
    sourceRevision: "github:reference-revision",
    sourceObservedAt: "2026-07-31T10:00:00.000Z",
    validators: [],
    state: "available",
    freshness: {
      assessment: "current",
      evidence: [{ kind: "github-scope", value: nativeScope }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope", state: "covered" }],
    },
    completion: "incomplete",
    diagnostics: [],
    projection: createMattReferenceProjection("github"),
  });
  if (observation.projection?.map === undefined) throw new Error("Expected a GitHub Map.");
  const providerObservations = [
    ...base.providerObservations.filter(
      (candidate) => candidate.binding.nativeScope !== ".scratch/portal",
    ),
    observation,
  ];
  const providerObservationSelections = [
    ...base.providerObservationSelections.filter(
      (candidate) => candidate.nativeScope !== ".scratch/portal",
    ),
    {
      provider: "matt-skills/v1" as const,
      nativeScope,
      observationId: observation.id,
      effectiveFreshness: "current" as const,
      latestAttempt: null,
    },
  ];
  const sources = [
    ...base.sources.filter((source) => !source.displayLocator.startsWith(".scratch/portal")),
    ...buildMattNativeSourceRecords([observation], base.basis.sitemapFingerprint),
  ];
  const snapshot = withPreviewAsset(
    parseRebuiltPlanningLineageFixture({
      ...base,
      efforts: {
        ...base.efforts,
        items: base.efforts.items.map((effort) =>
          effort.id === "effort:portal"
            ? { ...effort, workBinding: { provider: "matt-skills/v1" as const, nativeScope } }
            : effort,
        ),
      },
      providerObservations,
      providerObservationSelections,
      sources,
    }),
  );
  return {
    snapshot,
    nativeScope: mattNativeScopeSubject(observation),
    nativeSubject: { kind: "native-subject", id: observation.projection.map.ref },
    nativeScopeTitle: "example/reference issue #101",
    nativeSubjectTitle: "Reference Map",
  };
};

const degradedSnapshot = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.gates.validity !== "available" || snapshot.assets.validity !== "available") {
    throw new Error("Expected readable Gates and Assets.");
  }
  const candidate = {
    ...snapshot,
    gates: {
      validity: "partial" as const,
      items: snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [
        {
          code: "invalid-gate",
          target: "gate:one",
          message: "The requested Gate became unavailable.",
        },
      ],
    },
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) => ({
        ...asset,
        evidenceRoles: asset.evidenceRoles.filter((role) => role !== "passage-evidence"),
        passageEvidence: asset.passageEvidence.filter((evidence) => evidence.gateId !== "gate:one"),
      })),
    },
  };
  return projectSnapshotSchema.parse(withRebuiltPlanningLineage(candidate as ProjectSnapshotInput));
};

const viewportOverflow = async (page: Page) =>
  page.locator("body *").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.right > window.innerWidth + 0.5
        ? [{ tag: element.tagName, text: element.textContent?.trim().slice(0, 80) }]
        : [];
    }),
  );

const expectCalmOrdinarySurface = async (page: Page): Promise<void> => {
  const main = page.locator("main");
  await expect(main).not.toContainText(
    /Time unavailable|Quick Look|Discovered Work|Next Work Guidance|Selected context/u,
  );
  await expect(main).not.toContainText(/source:[0-9a-f]{64}/u);
  await expect(main).not.toContainText(/\.bearing\/state\//u);
  await expect(main).not.toContainText(/\b(?:roadmap|gate|effort|asset):[a-z0-9-]+\b/u);
  expect(await page.getByText("Read only", { exact: true }).count()).toBeLessThanOrEqual(1);
  expect(await viewportOverflow(page)).toEqual([]);
};

const sourceState = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const bytes = await readRepositorySourceBytes(root);
  return Object.fromEntries(
    Object.entries(bytes).filter(
      ([locator]) => locator.startsWith(".bearing/state/") || locator.startsWith(".scratch/"),
    ),
  );
};

type Scenario = Readonly<{
  name: "Local" | "GitHub";
  snapshot: ProjectSnapshot;
  nativeScope: PlanningLineageSubject;
  nativeSubject: PlanningLineageSubject;
  nativeScopeTitle: string;
  nativeSubjectTitle: string;
  nativeScopeEvidence: string;
}>;

let host: RunningTestPortal | undefined;
let homeRoot = "";
let fixtureRoot = "";

test.beforeAll(async () => {
  fixtureRoot = await realpath(await copyPortalProjectFixture("G3 Comprehension Project"));
  await runBuiltBearing(["sync", "--repo", fixtureRoot, "--initialize-provider-observations"]);
  homeRoot = await mkdtemp(join(tmpdir(), "bearing-g3-comprehension-browser-home-"));
  await mkdir(join(homeRoot, ".bearing"), { recursive: true });
  const catalog = {
    version: 1,
    entries: [{ entryId, repoRoot: fixtureRoot, displayName: "G3 Comprehension Project" }],
  };
  await Promise.all([
    writeFile(join(homeRoot, ".bearing/catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(
      join(homeRoot, ".bearing/catalog.backup.json"),
      `${JSON.stringify(catalog, null, 2)}\n`,
    ),
  ]);
  host = await startBuiltPortal(homeRoot);
});

test.afterAll(async () => {
  await stopBuiltPortal(host);
  await Promise.all(
    [homeRoot, fixtureRoot]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("G3 uses one parameterized comprehension contract journey for Local and GitHub", async ({
  context,
  page,
}) => {
  if (host === undefined) throw new Error("Ticket 24 built Portal did not start.");
  const local: Scenario = {
    name: "Local",
    snapshot: localSnapshot(),
    nativeScope: { kind: "native-scope", id: ".scratch/portal" },
    nativeSubject: {
      kind: "native-subject",
      id: ".scratch/portal/issues/02-review.md",
    },
    nativeScopeTitle: ".scratch/portal",
    nativeSubjectTitle: "Review the Roadmap journey",
    nativeScopeEvidence: ".scratch/portal",
  };
  const github = githubScenarioSnapshot();
  const scenarios: readonly Scenario[] = [
    local,
    {
      name: "GitHub",
      snapshot: github.snapshot,
      nativeScope: github.nativeScope,
      nativeSubject: github.nativeSubject,
      nativeScopeTitle: github.nativeScopeTitle,
      nativeSubjectTitle: github.nativeSubjectTitle,
      nativeScopeEvidence: "github-matt-v1:",
    },
  ];
  await page.goto(host.url);
  await page
    .getByRole("list", { name: "Registered Bearing projects" })
    .getByRole("link", { name: /G3 Comprehension Project/u })
    .click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  let activeSnapshot = local.snapshot;
  let syncTarget = degradedSnapshot(local.snapshot);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.route(`**/api/v1/projects/${entryId}/snapshot`, (route) =>
    route.fulfill({ json: readyEnvelope(activeSnapshot) }),
  );
  await page.route(`**/api/v1/projects/${entryId}/sync`, (route) =>
    route.fulfill({ json: forcedEnvelope(syncTarget) }),
  );
  const beforeSources = await sourceState(fixtureRoot);

  for (const scenario of scenarios) {
    activeSnapshot = scenario.snapshot;
    syncTarget = degradedSnapshot(scenario.snapshot);
    posts.length = 0;
    const roadmapHref = planningLineageSubjectHref(entryId, {
      kind: "roadmap",
      id: "roadmap:portal",
    });
    const gateHref = planningLineageSubjectHref(entryId, {
      kind: "gate",
      id: "gate:two",
    });
    const agentExplanation = {
      question: "Can the current Portal journey be reviewed without changing its governed state?",
      answer:
        "Portal Evolution targets Overview proven. Web Portal Validation remains active, its provider completion is incomplete, and no Gate Passage is inferred from this reading.",
      optionalPortalLink: roadmapHref,
    } as const;
    expect(agentExplanation.answer).toContain("no Gate Passage");
    expect(agentExplanation.optionalPortalLink).toBe(roadmapHref);

    if (scenario.name === "Local") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const primaryDestinations = [
        `/projects/${entryId}`,
        `/projects/${entryId}/roadmaps`,
        `/projects/${entryId}/assets`,
        `/projects/${entryId}/audit`,
      ] as const;
      for (const width of [1280, 640, 375] as const) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        for (const destination of primaryDestinations) {
          await page.goto(`${host.url}${destination}`);
          await expectCalmOrdinarySurface(page);
        }
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${host.url}${agentExplanation.optionalPortalLink}`);
    await expect(page).toHaveURL(`${host.url}${roadmapHref}`);
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Canonical Parent Path" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(`${host.url}${roadmapHref}`);
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();

    await page.locator(`a[href="${gateHref}"]`).first().click();
    await expect(page).toHaveURL(`${host.url}${gateHref}`);
    await expect(page.getByRole("heading", { name: "Overview proven", level: 1 })).toBeVisible();
    const effortLink = page
      .getByLabel("Lineage Context")
      .getByRole("link", { name: /^Web Portal Validation\b/u });
    await effortLink.click();
    const effortHref = planningLineageSubjectHref(entryId, {
      kind: "effort",
      id: "effort:portal",
    });
    await expect(page).toHaveURL(`${host.url}${effortHref}`);
    await expect(
      page.getByRole("heading", { name: "Web Portal Validation", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(scenario.nativeScopeEvidence, { exact: false }).first(),
    ).toBeVisible();

    const scopeHref = planningLineageSubjectHref(entryId, scenario.nativeScope);
    const scopeLink = page.locator(`a[href="${scopeHref}"]`).first();
    await scopeLink.click();
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, scenario.nativeScope)}`,
    );
    await expect(
      page.getByRole("heading", { name: scenario.nativeScopeTitle, level: 1 }),
    ).toBeVisible();
    const subjectLink = page.getByRole("link", { name: scenario.nativeSubjectTitle, exact: true });
    if ((await subjectLink.count()) === 1) await subjectLink.click();
    else
      await page.goto(`${host.url}${planningLineageSubjectHref(entryId, scenario.nativeSubject)}`);
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, scenario.nativeSubject)}`,
    );
    await expect(
      page.getByRole("heading", { name: scenario.nativeSubjectTitle, level: 1 }),
    ).toBeVisible();

    await page.goto(`${host.url}/projects/${entryId}/assets`);
    const find = page.getByRole("button", { name: "Find in project" });
    await find.focus();
    await page.keyboard.press("Enter");
    const findDialog = page.getByRole("dialog", { name: "Find in project" });
    const searchbox = findDialog.getByRole("searchbox", {
      name: "Search identity, title, or semantic phrase",
    });
    await expect(searchbox).toBeFocused();
    await searchbox.fill("whole-project orientation");
    const result = findDialog.getByRole("option").filter({ hasText: "Portal Evolution" }).first();
    await expect(result).toContainText("Prove whole-project orientation.");
    await expect(result).not.toContainText("Intent");
    await expect(result).toContainText("Roadmap");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(find).toBeFocused();
    await find.press("Enter");
    await findDialog
      .getByRole("searchbox", {
        name: "Search identity, title, or semantic phrase",
      })
      .fill("roadmap:portal");
    const identityResult = findDialog
      .getByRole("option")
      .filter({ hasText: "Portal Evolution" })
      .first();
    await expect(identityResult).not.toContainText("roadmap:portal");
    await expect(identityResult).not.toContainText("Identity");
    await identityResult.click();
    await expect(page).toHaveURL(/roadmap%3Aportal/);

    const anchoredRoadmap = `${roadmapHref}#roadmap.intent`;
    await page.goto(`${host.url}${anchoredRoadmap}`);
    await expect(page.locator("#roadmap\\.intent")).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();

    await page.goto(`${host.url}/projects/${entryId}/assets`);
    const evidenceFilter = page.getByRole("combobox", { name: "Evidence", exact: true });
    await evidenceFilter.selectOption("cited");
    const assetRow = page.getByRole("link", { name: /Planning Model Evidence/u });
    await assetRow.scrollIntoViewIfNeeded();
    await assetRow.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, {
        kind: "asset",
        id: "asset:planning-model-evidence",
      })}`,
    );
    await page.goBack();
    await expect(evidenceFilter).toHaveValue("cited");

    await page.getByRole("combobox", { name: "Evidence", exact: true }).selectOption("all");
    const uncitedAsset = page.getByRole("link", { name: /Uncited Fixture Evidence/u });
    if (scenario.name === "Local") {
      await expect(uncitedAsset).toHaveAccessibleName(/Review the Roadmap journey/u);
    }
    await uncitedAsset.click();
    if (scenario.name === "Local") {
      await expect(
        page.getByText("Owned by Review the Roadmap journey.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Produced For: Build the Roadmap journey", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/\.scratch\/portal\/issues\//u)).toHaveCount(0);
      const nativeOwner = page
        .getByLabel("Lineage Context")
        .getByRole("link", { name: /^Review the Roadmap journey is owned by/u });
      await expect(nativeOwner).toBeVisible();
      await nativeOwner.click();
      await expect(page).toHaveURL(
        `${host.url}${planningLineageSubjectHref(entryId, {
          kind: "native-subject",
          id: ".scratch/portal/issues/02-review.md",
        })}`,
      );
      await page.goBack();
    }
    const previewTab = context.waitForEvent("page");
    await page.getByRole("link", { name: /View Content/u }).click();
    const previewPage = await previewTab;
    await expect(previewPage.getByText("Uncited Fixture Evidence", { exact: false })).toBeVisible();
    await expect(previewPage.getByText("current-checkout content", { exact: false })).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: "Return to Asset detail" }),
    ).toHaveAttribute(
      "data-bearing-return-href",
      planningLineageSubjectHref(entryId, {
        kind: "asset",
        id: "asset:fixture-uncited",
      }),
    );
    await previewPage.close();
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, {
        kind: "asset",
        id: "asset:fixture-uncited",
      })}`,
    );

    await page.goto(`${host.url}/projects/${entryId}/assets`);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    expect(await viewportOverflow(page)).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    const degradedGateHref = planningLineageSubjectHref(entryId, {
      kind: "gate",
      id: "gate:one",
    });
    await page.goto(`${host.url}${degradedGateHref}`);
    await page.getByRole("button", { name: "Sync" }).click();
    await expect(page.getByRole("heading", { name: "Gate unavailable", level: 1 })).toBeVisible();
    await expect(
      page.getByText("Partial collection coverage cannot establish", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to project Overview" })).toBeVisible();
    expect(posts).toEqual([`${host.url}/api/v1/projects/${entryId}/sync`]);
  }

  expect(await sourceState(fixtureRoot)).toEqual(beforeSources);
});

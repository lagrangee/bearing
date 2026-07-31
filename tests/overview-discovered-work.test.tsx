import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NativeScopeDiscoveryProjection } from "../src/project-snapshot/contract";
import { OverviewDiscoveredWork } from "../src/portal-ui/overview-discovered-work";

const render = (
  discovery: NativeScopeDiscoveryProjection,
  operation: Readonly<{ state: "idle" | "running" | "failed" }> = { state: "idle" },
) =>
  renderToStaticMarkup(
    <OverviewDiscoveredWork discovery={discovery} onRefresh={() => {}} operation={operation} />,
  );

const observed = {
  state: "available",
  provider: "matt-skills/v1",
  observationId: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-07-31T07:00:00.000Z",
  freshness: "current",
  coverage: "complete",
  count: { kind: "exact", value: 1 },
  confirmedUnboundEmpty: false,
  diagnostics: [],
  latestAttempt: null,
  scopes: [
    {
      summary: {
        identity: "local-scope:.scratch/native",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/native" },
        locator: ".scratch/native",
        driver: "local",
        rootRole: "wayfinder-map",
        title: "Native work",
        lifecycle: "open",
        classification: "map",
        admission: ["contract-map"],
        subjects: [
          {
            identity: "local:.scratch/native/map.md",
            locator: ".scratch/native/map.md",
            title: "Native work",
            classification: "map",
            lifecycle: "open",
            parentIdentity: null,
            admission: ["contract-map"],
          },
        ],
      },
      bindingContext: { state: "unbound", effortIds: [] },
      detailAvailability: "summary-only",
    },
  ],
} as NativeScopeDiscoveryProjection;

test("Overview offers explicit discovery without manufacturing a never-run empty list", () => {
  const html = render({ state: "never-run" });
  expect(html).toContain("Discovery has not run");
  expect(html).toContain("Discover native work");
  expect(html).not.toContain("No unlinked native work observed");
});

test("Overview renders only unbound summary cards with truthful collection labels", () => {
  const html = render(observed);
  expect(html).toContain("Discovered Work");
  expect(html).toContain("Native work");
  expect(html).toContain("Not linked");
  expect(html).toContain("Summary only");
  expect(html).toContain("Classification");
  expect(html).toContain("map");
  expect(html).toContain("Lifecycle");
  expect(html).toContain("open");
  expect(html).toContain("Copy Agent discussion prompt");
  expect(html).toContain("do not establish completion or readiness");
});

test("running refresh retains the prior observation and complete zero becomes confirmation", () => {
  const running = render(observed, { state: "running" });
  expect(running).toContain("prior observation remains visible");
  expect(running).toContain("Native work");
  expect(running).toContain("disabled");

  if (observed.state === "never-run") throw new Error("Expected observed fixture.");
  const empty = render({
    ...observed,
    scopes: [],
    count: { kind: "exact", value: 0 },
    confirmedUnboundEmpty: true,
  });
  expect(empty).toContain("No unlinked native work observed");
  expect(empty).not.toContain("Copy Agent discussion prompt");
});

test("distinguishes a selected partial observation from a failed attempt retaining prior evidence", () => {
  if (observed.state === "never-run") throw new Error("Expected observed fixture.");
  const partialObservation = {
    ...observed,
    state: "partial",
    coverage: "incomplete",
    count: { kind: "at-least", value: 1 },
    latestAttempt: {
      observationId: observed.observationId,
      state: "partial",
      observedAt: observed.observedAt,
      diagnostics: [],
    },
  } as NativeScopeDiscoveryProjection;
  const partialHtml = render(partialObservation);
  expect(partialHtml).toContain("latest partial observation is visible");
  expect(partialHtml).not.toContain("Prior trustworthy summaries");

  const retainedAfterFailure = {
    ...observed,
    freshness: "undetermined",
    count: { kind: "at-least", value: 1 },
    latestAttempt: {
      observationId: `sha256:${"b".repeat(64)}`,
      state: "unavailable",
      observedAt: "2026-07-31T07:05:00.000Z",
      diagnostics: [
        {
          code: "matt.github.discovery.network",
          class: "network",
          impact: "blocking",
          target: "github.com",
          message: "The repository could not be read.",
        },
      ],
    },
  } as NativeScopeDiscoveryProjection;
  const retainedHtml = render(retainedAfterFailure);
  expect(retainedHtml).toContain("Prior trustworthy summaries remain undetermined");
  expect(retainedHtml).toContain("Latest attempt:");
  expect(retainedHtml).toContain("matt.github.discovery.network");
  expect(retainedHtml).toContain("The repository could not be read.");
});

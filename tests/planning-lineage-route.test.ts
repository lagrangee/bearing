import { expect, test } from "bun:test";
import { createPlanningLineageAgentHandoff } from "../src/agent-planning-lineage-handoff";
import {
  type PlanningLineageSubject,
  planningLineageFilteredViewHref,
  planningLineageSubjectHref,
} from "../src/planning-lineage-route";
import { parsePortalRoute } from "../src/portal-ui/project-route";

const subjects: readonly PlanningLineageSubject[] = [
  { kind: "roadmap", id: "roadmap:portal" },
  { kind: "gate", id: "gate:two" },
  { kind: "effort", id: "effort:portal" },
  { kind: "authority", id: "authority:architecture" },
  { kind: "alignment-check", id: "alignment-check:portal" },
  { kind: "planning-review", id: "planning-review:sequence" },
  { kind: "asset", id: "asset:planning-model-evidence" },
];

test("round-trips every durable Bearing subject through one identity route contract", () => {
  for (const subject of subjects) {
    const href = planningLineageSubjectHref("bearing", subject);
    const url = new URL(href, "http://portal.test");
    expect(parsePortalRoute(url.pathname, url.search, url.hash)).toEqual({
      kind: "project",
      entryId: "bearing",
      section: "lineage",
      subject: { validity: "valid", value: subject },
    });
  }
});

test("route identity ignores titles, source locators, parents, focus, and array positions", () => {
  expect(
    planningLineageSubjectHref("bearing", { kind: "gate", id: "gate:two" }, "gate.exit-criteria"),
  ).toBe("/projects/bearing/lineage/gate/gate%3Atwo#gate.exit-criteria");
  expect(
    parsePortalRoute("/projects/bearing/lineage/gate/gate%3Atwo", "", "#gate.exit-criteria"),
  ).toMatchObject({
    kind: "project",
    entryId: "bearing",
    section: "lineage",
    subject: {
      validity: "valid",
      value: { kind: "gate", id: "gate:two" },
    },
    semanticAnchor: "gate.exit-criteria",
  });
});

test("keeps well-shaped unavailable targets on their requested project route", () => {
  expect(parsePortalRoute("/projects/bearing/lineage/gate/gate%3Amissing")).toMatchObject({
    kind: "project",
    entryId: "bearing",
    section: "lineage",
    subject: {
      validity: "valid",
      value: { kind: "gate", id: "gate:missing" },
    },
  });
  expect(parsePortalRoute("/projects/bearing/lineage/gate/not-a-gate")).toEqual({
    kind: "project",
    entryId: "bearing",
    section: "lineage",
    subject: {
      validity: "invalid",
      kind: "gate",
      requestedId: "not-a-gate",
    },
  });
});

test("encodes owner, relation, filter, and canonical order in a non-subject filtered view", () => {
  const href = planningLineageFilteredViewHref(
    "bearing",
    { kind: "gate", id: "gate:two" },
    "outcome.contributing-efforts",
    "available",
  );
  expect(href).toBe(
    "/projects/bearing/lineage/gate/gate%3Atwo/relations/outcome_contributing-efforts?filter=available&order=canonical",
  );
  const url = new URL(href, "http://portal.test");
  expect(parsePortalRoute(url.pathname, url.search, url.hash)).toMatchObject({
    kind: "project",
    section: "lineage",
    subject: {
      validity: "valid",
      value: { kind: "gate", id: "gate:two" },
    },
    filteredView: {
      validity: "valid",
      relation: "outcome.contributing-efforts",
      filter: "available",
      order: "canonical",
    },
  });
  expect(
    parsePortalRoute(
      "/projects/bearing/lineage/gate/gate%3Atwo/relations/outcome.contributing-efforts",
      "?filter=available&order=canonical",
    ),
  ).toMatchObject({
    kind: "project",
    filteredView: { validity: "invalid" },
  });
  for (const search of [
    "",
    "?filter=available",
    "?order=canonical",
    "?filter=available&filter=all&order=canonical",
    "?filter=available&order=canonical&order=canonical",
  ]) {
    expect(
      parsePortalRoute(
        "/projects/bearing/lineage/gate/gate%3Atwo/relations/outcome_contributing-efforts",
        search,
      ),
    ).toMatchObject({
      kind: "project",
      filteredView: { validity: "invalid" },
    });
  }
});

test("rejects invalid generator inputs instead of emitting a second URL dialect", () => {
  expect(() =>
    planningLineageSubjectHref("not/an-entry", { kind: "gate", id: "gate:two" }),
  ).toThrow();
  expect(() =>
    planningLineageSubjectHref("bearing", { kind: "gate", id: "effort:portal" } as never),
  ).toThrow();
});

test("Agent handoff and Portal navigation use the same route generator", () => {
  const subject = { kind: "gate", id: "gate:two" } as const;
  const portalRoute = planningLineageSubjectHref("bearing", subject, "gate.exit-criteria");

  expect(createPlanningLineageAgentHandoff("bearing", subject, "gate.exit-criteria")).toEqual({
    identity: subject,
    portalRoute,
  });
});

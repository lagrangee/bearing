import type { ProviderObservationSelection } from "../../provider-observation-contract";
import { assessSelectedProviderObservationEvidence } from "../../provider-observation-contract";
import type {
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattSemanticSectionAvailability,
  MattWayfinderTicket,
} from "./model";
import type { MattObservationView, MattProjectedObject } from "./projection";
import { mattObjects } from "./projection";
import {
  buildMattNativeWorkReadingState,
  type MattNativeWorkReadingContext,
  type MattNativeWorkReadingState,
} from "./reading-state";

const PREVIEW_LIMIT = 3;

export type MattNativeWorkRegionContext = MattNativeWorkReadingContext;

export type MattNativeWorkRegionCount =
  | Readonly<{ mode: "exact" | "at-least"; value: number }>
  | Readonly<{ mode: "unavailable" }>;

export type MattNativeWorkRegionRole = "map" | "spec" | "wayfinder" | "delivery" | "incoming";

export type MattNativeWorkRegionFrontier =
  | "resolved"
  | "blocked"
  | "claimed"
  | "ready"
  | "uncertain";

export type MattNativeWorkRegionDiagnostic = Readonly<{
  code: string;
  target: string;
  message: string;
}>;

export type MattNativeWorkRegionItem = Readonly<{
  reference: string;
  role: MattNativeWorkRegionRole;
  title: string;
  nativeLifecycle: string;
  frontier?: MattNativeWorkRegionFrontier | undefined;
  claimant?: string | undefined;
  claimantAmbiguous?: boolean | undefined;
  blockers?: readonly string[] | undefined;
  answerAvailability?: "available" | "unavailable" | undefined;
  decisionEvidence?:
    | Extract<MattWayfinderTicket["lifecycle"], { state: "resolved-on-route" }>["decisionSource"]
    | undefined;
  trackerClosure?: "open" | "closed" | undefined;
  completionEvidence?: readonly string[] | undefined;
  category?: MattIncomingIssue["classification"]["category"] | undefined;
  routingState?: MattIncomingIssue["classification"]["state"] | undefined;
  nativeDisposition?:
    | Extract<MattIncomingIssue["lifecycle"], { state: "closed" }>["disposition"]
    | undefined;
  diagnosticCodes?: readonly MattNativeWorkRegionDiagnostic["code"][] | undefined;
  diagnosticMessages?: readonly string[] | undefined;
}>;

export type MattNativeWorkRegionRoleGroup = Readonly<{
  role: MattNativeWorkRegionRole;
  label: string;
  availability: MattSemanticSectionAvailability;
  count: MattNativeWorkRegionCount;
  items: readonly MattNativeWorkRegionItem[];
}>;

type MapPreview = Readonly<{
  label: string;
  semanticAnchor: "map.fog" | "map.decisions" | "map.out-of-scope";
}>;

export type MattNativeWorkRegionMapChapter =
  | Readonly<{ availability: "unavailable" | "unsupported" }>
  | Readonly<{
      availability: "available";
      reference: string;
      title: string;
      destination:
        | Readonly<{ availability: "available"; value: string }>
        | Readonly<{ availability: "confirmed-empty" | "unavailable" | "unsupported" }>;
      lifecycle: MattMap["lifecycle"]["state"];
      totals: Readonly<{
        fog: MattNativeWorkRegionCount;
        decisions: MattNativeWorkRegionCount;
        outOfScope: MattNativeWorkRegionCount;
      }>;
      previews: Readonly<{
        fog: readonly MapPreview[];
        decisions: readonly MapPreview[];
        outOfScope: readonly MapPreview[];
      }>;
    }>;

export type MattNativeWorkRegionModel = Readonly<{
  context:
    | Readonly<{ state: "bound"; label: "Contributing Work"; effortIds: readonly string[] }>
    | Readonly<{
        state: "unbound";
        label: "Discovered Work";
        detail: "Not linked to an Effort";
      }>
    | Readonly<{
        state: "attention";
        label: "Binding needs attention";
        reason: Extract<MattNativeWorkRegionContext, { state: "attention" }>["reason"];
        effortIds: readonly string[];
        detail: string;
      }>;
  readingState: MattNativeWorkReadingState;
  total: MattNativeWorkRegionCount;
  roles: readonly MattNativeWorkRegionRoleGroup[];
  views: readonly [
    Readonly<{
      key: "current";
      label: "Current";
      count: MattNativeWorkRegionCount;
      items: readonly MattNativeWorkRegionItem[];
    }>,
    Readonly<{
      key: "history";
      label: "History";
      count: MattNativeWorkRegionCount;
      items: readonly MattNativeWorkRegionItem[];
    }>,
    Readonly<{
      key: "all";
      label: "All";
      count: MattNativeWorkRegionCount;
      items: readonly MattNativeWorkRegionItem[];
      groups: readonly MattNativeWorkRegionRoleGroup[];
    }>,
  ];
  mapChapter?: MattNativeWorkRegionMapChapter | undefined;
  diagnostics: readonly MattNativeWorkRegionDiagnostic[];
}>;

const roleFor = (object: MattProjectedObject): MattNativeWorkRegionRole => {
  switch (object.kind) {
    case "map":
      return "map";
    case "spec":
      return "spec";
    case "wayfinder-ticket":
      return "wayfinder";
    case "delivery-ticket":
      return "delivery";
    case "incoming-issue":
      return "incoming";
  }
};

const ROLE_DEFINITIONS = [
  ["map", "Map"],
  ["spec", "Spec / PRD"],
  ["wayfinder", "Wayfinder"],
  ["delivery", "Delivery"],
  ["incoming", "Incoming"],
] as const satisfies readonly (readonly [MattNativeWorkRegionRole, string])[];

const normalizedContext = (
  context: MattNativeWorkRegionContext,
): MattNativeWorkRegionModel["context"] => {
  if (context.state === "bound") {
    return { state: "bound", label: "Contributing Work", effortIds: context.effortIds };
  }
  if (context.state === "unbound") {
    return {
      state: "unbound",
      label: "Discovered Work",
      detail: "Not linked to an Effort",
    };
  }
  const detailByReason = {
    "binding-conflict":
      "More than one Effort binds this native scope. No contributing Effort is selected.",
    "bound-unresolved":
      "The declared Work Binding cannot be resolved to a trustworthy native scope.",
    "identity-mismatch": "The declared Work Binding and observed native identity do not match.",
    "root-kind-conflict":
      "The same native root has conflicting binding definitions. No interpretation is selected.",
  } as const;
  return {
    state: "attention",
    label: "Binding needs attention",
    reason: context.reason,
    effortIds: context.effortIds,
    detail: detailByReason[context.reason],
  };
};

const readable = (
  observation: MattObservationView | undefined,
): observation is Extract<MattObservationView, { state: "available" | "partial" }> =>
  observation?.state === "available" || observation?.state === "partial";

const completeCoverage = (observation: MattObservationView | undefined): boolean =>
  observation?.state === "available" &&
  observation.coverage.assessment === "complete" &&
  observation.coverage.dimensions.every(
    (dimension) => dimension.state !== "gap" && dimension.state !== "conflict",
  );

const countFor = (
  observation: MattObservationView | undefined,
  value: number,
): MattNativeWorkRegionCount =>
  !readable(observation)
    ? { mode: "unavailable" }
    : completeCoverage(observation)
      ? { mode: "exact", value }
      : { mode: "at-least", value };

const roleAvailability = (
  observation: MattObservationView | undefined,
  itemCount: number,
): MattSemanticSectionAvailability => {
  if (itemCount > 0) return "available";
  return completeCoverage(observation) ? "confirmed-empty" : "unavailable";
};

const semanticEvidenceComplete = (object: MattProjectedObject): boolean =>
  object.semanticSections.every(
    (section) => section.availability === "available" || section.availability === "confirmed-empty",
  );

const trackerClosureState = (ticket: MattWayfinderTicket | MattDeliveryTicket): "open" | "closed" =>
  ticket.trackerClosure.state;

const isTerminal = (object: MattProjectedObject): boolean => {
  switch (object.kind) {
    case "map":
      return object.lifecycle.state === "resolved";
    case "spec":
      return object.lifecycle.state === "superseded";
    case "wayfinder-ticket":
      return object.lifecycle.state !== "open";
    case "delivery-ticket":
      return object.lifecycle.state === "completed";
    case "incoming-issue":
      return object.lifecycle.state === "closed" || object.classification.state === "wontfix";
  }
};

const anomaliesFor = (object: MattProjectedObject): readonly MattNativeWorkRegionDiagnostic[] => {
  if (object.kind === "wayfinder-ticket") {
    return [
      ...(object.lifecycle.state === "open" && object.answer.availability === "available"
        ? [
            {
              code: "matt.work-region.answer-present-while-open" as const,
              target: object.ref,
              message:
                "An Answer is present while the Wayfinder lifecycle remains open. Both facts are preserved.",
            },
          ]
        : []),
      ...(object.lifecycle.state === "open" && object.trackerClosure.state === "closed"
        ? [
            {
              code: "matt.work-region.closure-without-resolution" as const,
              target: object.ref,
              message:
                "The tracker is closed without provider-proven Wayfinder resolution. Closure is not promoted to resolution.",
            },
          ]
        : []),
      ...(object.lifecycle.state === "resolved-on-route" &&
      object.answer.availability === "unavailable"
        ? [
            {
              code: "matt.work-region.decision-without-answer" as const,
              target: object.ref,
              message:
                "A Map decision backlink exists without an available Answer. Neither fact is repaired by inference.",
            },
          ]
        : []),
    ];
  }
  if (object.kind === "delivery-ticket") {
    return object.lifecycle.state !== "completed" && object.trackerClosure.state === "closed"
      ? [
          {
            code: "matt.work-region.closure-without-completion",
            target: object.ref,
            message:
              "The tracker is closed without provider-proven Delivery completion. Closure is not promoted to completion.",
          },
        ]
      : [];
  }
  if (object.kind === "incoming-issue") {
    const routedWontfix = object.classification.state === "wontfix";
    const closedWontfix =
      object.lifecycle.state === "closed" && object.lifecycle.disposition === "wontfix";
    return routedWontfix === closedWontfix
      ? []
      : [
          {
            code: "matt.work-region.wontfix-lifecycle-disagreement",
            target: object.ref,
            message:
              "Matt routing and native closure disagree about wontfix. Classification and lifecycle remain independent.",
          },
        ];
  }
  return [];
};

const diagnosticTargetsObject = (
  diagnostic: Pick<MattNativeWorkRegionDiagnostic, "target">,
  object: MattProjectedObject,
): boolean => diagnostic.target === object.ref || diagnostic.target.startsWith(`${object.ref}#`);

const blockersByReference = (
  observation: Extract<MattObservationView, { state: "available" | "partial" }>,
): ReadonlyMap<string, readonly string[]> => {
  const grouped = new Map<string, string[]>();
  for (const relation of observation.projection.graph.blockedBy) {
    const existing = grouped.get(relation.blocked) ?? [];
    existing.push(relation.blocker);
    grouped.set(relation.blocked, existing);
  }
  return grouped;
};

const frontierForWayfinder = (
  ticket: MattWayfinderTicket,
  blockers: readonly string[],
  terminalReferences: ReadonlySet<string>,
  trustworthy: boolean,
): MattNativeWorkRegionFrontier => {
  if (ticket.lifecycle.state !== "open") return "resolved";
  if (blockers.some((blocker) => !terminalReferences.has(blocker))) return "blocked";
  if (ticket.claim.state === "claimed") return "claimed";
  return trustworthy && semanticEvidenceComplete(ticket) ? "ready" : "uncertain";
};

const frontierForDelivery = (
  ticket: MattDeliveryTicket,
  blockers: readonly string[],
  terminalReferences: ReadonlySet<string>,
  trustworthy: boolean,
): MattNativeWorkRegionFrontier => {
  if (ticket.lifecycle.state === "completed") return "resolved";
  if (blockers.some((blocker) => !terminalReferences.has(blocker))) return "blocked";
  return ticket.lifecycle.state === "open" && trustworthy && semanticEvidenceComplete(ticket)
    ? "ready"
    : "uncertain";
};

const itemFor = (
  object: MattProjectedObject,
  blockers: readonly string[],
  terminalReferences: ReadonlySet<string>,
  trustworthy: boolean,
  diagnostics: readonly MattNativeWorkRegionDiagnostic[],
): MattNativeWorkRegionItem => {
  const base = {
    reference: object.ref,
    role: roleFor(object),
    title: object.title,
    nativeLifecycle: object.lifecycle.state,
    ...(diagnostics.length === 0
      ? {}
      : {
          diagnosticCodes: diagnostics.map((diagnostic) => diagnostic.code),
          diagnosticMessages: diagnostics.map((diagnostic) => diagnostic.message),
        }),
  };
  switch (object.kind) {
    case "map":
    case "spec":
      return base;
    case "wayfinder-ticket":
      return {
        ...base,
        frontier: frontierForWayfinder(object, blockers, terminalReferences, trustworthy),
        ...(object.claim.state === "claimed" && object.claim.claimant !== undefined
          ? { claimant: object.claim.claimant }
          : {}),
        ...(object.claim.state === "claimed" && object.claim.claimantAmbiguous !== undefined
          ? { claimantAmbiguous: object.claim.claimantAmbiguous }
          : {}),
        blockers,
        answerAvailability: object.answer.availability,
        ...(object.lifecycle.state === "resolved-on-route"
          ? { decisionEvidence: object.lifecycle.decisionSource }
          : {}),
        trackerClosure: trackerClosureState(object),
      };
    case "delivery-ticket":
      return {
        ...base,
        frontier: frontierForDelivery(object, blockers, terminalReferences, trustworthy),
        blockers,
        trackerClosure: trackerClosureState(object),
        ...(object.lifecycle.state === "completed"
          ? { completionEvidence: object.lifecycle.evidence }
          : {}),
      };
    case "incoming-issue":
      return {
        ...base,
        category: object.classification.category,
        routingState: object.classification.state,
        ...(object.lifecycle.state === "closed"
          ? { nativeDisposition: object.lifecycle.disposition }
          : {}),
      };
  }
};

const currentItem = (item: MattNativeWorkRegionItem): boolean =>
  item.diagnosticCodes !== undefined ||
  item.frontier === "claimed" ||
  item.frontier === "ready" ||
  item.frontier === "blocked" ||
  item.frontier === "uncertain" ||
  (item.role === "map" && item.nativeLifecycle === "active") ||
  (item.role === "spec" &&
    (item.nativeLifecycle === "draft" || item.nativeLifecycle === "ready-for-agent")) ||
  (item.role === "incoming" && item.nativeLifecycle === "open" && item.routingState !== "wontfix");

const historyItem = (item: MattNativeWorkRegionItem): boolean =>
  item.frontier === "resolved" ||
  (item.role === "map" && item.nativeLifecycle === "resolved") ||
  (item.role === "spec" && item.nativeLifecycle === "superseded") ||
  (item.role === "incoming" &&
    (item.nativeLifecycle === "closed" || item.routingState === "wontfix"));

const mapCountFor = (
  observation: MattObservationView | undefined,
  map: MattMap,
  role: "map.fog" | "map.decisions" | "map.out-of-scope",
  value: number,
): MattNativeWorkRegionCount => {
  const availability = map.semanticSections.find((section) => section.role === role)?.availability;
  return availability === "available" || availability === "confirmed-empty"
    ? countFor(observation, value)
    : { mode: "unavailable" };
};

const mapChapterFor = (
  observation: MattObservationView | undefined,
): MattNativeWorkRegionMapChapter | undefined => {
  if (!readable(observation)) return { availability: "unavailable" };
  const map = observation.projection.map;
  if (map === undefined) {
    return completeCoverage(observation) ? undefined : { availability: "unavailable" };
  }
  const destinationAvailability =
    map.semanticSections.find((section) => section.role === "map.destination")?.availability ??
    "unavailable";
  return {
    availability: "available",
    reference: map.ref,
    title: map.title,
    destination:
      destinationAvailability === "available"
        ? { availability: "available", value: map.destination }
        : { availability: destinationAvailability },
    lifecycle: map.lifecycle.state,
    totals: {
      fog: mapCountFor(observation, map, "map.fog", map.fog.length),
      decisions: mapCountFor(observation, map, "map.decisions", map.decisions.length),
      outOfScope: mapCountFor(observation, map, "map.out-of-scope", map.outOfScope.length),
    },
    previews: {
      fog: map.fog.slice(0, PREVIEW_LIMIT).map((label) => ({
        label,
        semanticAnchor: "map.fog" as const,
      })),
      decisions: map.decisions.slice(0, PREVIEW_LIMIT).map((decision) => ({
        label: decision.gist,
        semanticAnchor: "map.decisions" as const,
      })),
      outOfScope: map.outOfScope.slice(0, PREVIEW_LIMIT).map((entry) => ({
        label: entry.rationale,
        semanticAnchor: "map.out-of-scope" as const,
      })),
    },
  };
};

export const buildMattNativeWorkRegion = (
  observation: MattObservationView | undefined,
  selections: readonly ProviderObservationSelection[],
  context: MattNativeWorkRegionContext,
  readingState: MattNativeWorkReadingState = buildMattNativeWorkReadingState(
    observation,
    selections,
    context,
  ),
): MattNativeWorkRegionModel => {
  const objects = mattObjects(observation);
  const evidence = assessSelectedProviderObservationEvidence(
    observation,
    observation === undefined
      ? undefined
      : selections.find((selection) => selection.observationId === observation.id),
  );
  const trustworthy = evidence.frontierEvidence === "trustworthy";
  const terminalReferences = new Set<string>(
    objects.filter(isTerminal).map((object) => String(object.ref)),
  );
  const blockers = readable(observation) ? blockersByReference(observation) : new Map();
  const diagnostics = [
    ...objects.flatMap(anomaliesFor),
    ...readingState.observation.diagnostics
      .filter((diagnostic) => objects.some((object) => diagnosticTargetsObject(diagnostic, object)))
      .map((diagnostic) => ({
        code: diagnostic.code,
        target: diagnostic.target,
        message: diagnostic.message,
      })),
  ].filter(
    (diagnostic, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.code === diagnostic.code &&
          candidate.target === diagnostic.target &&
          candidate.message === diagnostic.message,
      ) === index,
  );
  const diagnosticsByTarget = new Map<string, MattNativeWorkRegionDiagnostic[]>();
  for (const object of objects) {
    diagnosticsByTarget.set(
      object.ref,
      diagnostics.filter((diagnostic) => diagnosticTargetsObject(diagnostic, object)),
    );
  }
  const regionItems = objects.map((object) =>
    itemFor(
      object,
      blockers.get(object.ref) ?? [],
      terminalReferences,
      trustworthy,
      diagnosticsByTarget.get(object.ref) ?? [],
    ),
  );
  const roles = ROLE_DEFINITIONS.map(([role, label]): MattNativeWorkRegionRoleGroup => {
    const roleItems = regionItems.filter((item) => item.role === role);
    return {
      role,
      label,
      availability: roleAvailability(observation, roleItems.length),
      count: countFor(observation, roleItems.length),
      items: roleItems,
    };
  });
  const current = regionItems.filter(currentItem);
  const history = regionItems.filter(historyItem);
  const mapChapter = mapChapterFor(observation);
  return {
    context: normalizedContext(context),
    readingState,
    total: countFor(observation, regionItems.length),
    roles,
    views: [
      {
        key: "current",
        label: "Current",
        count: countFor(observation, current.length),
        items: current,
      },
      {
        key: "history",
        label: "History",
        count: countFor(observation, history.length),
        items: history,
      },
      {
        key: "all",
        label: "All",
        count: countFor(observation, regionItems.length),
        items: regionItems,
        groups: roles,
      },
    ],
    ...(mapChapter === undefined ? {} : { mapChapter }),
    diagnostics,
  };
};

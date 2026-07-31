import type { EffortTopology, GateTopology, RoadmapTopology } from "./artifact-model";
import type { StructuralDiagnostic } from "./types";

const uniqueById = <T extends Readonly<{ id: string }>>(items: readonly T[]): Map<string, T> => {
  const grouped = new Map<string, T[]>();
  for (const item of items) grouped.set(item.id, [...(grouped.get(item.id) ?? []), item]);
  return new Map(
    [...grouped.entries()].flatMap(([id, matches]) =>
      matches.length === 1 && matches[0] !== undefined ? [[id, matches[0]] as const] : [],
    ),
  );
};

export const deriveTopologyDiagnostics = (
  roadmaps: readonly RoadmapTopology[],
  gates: readonly GateTopology[],
  efforts: readonly EffortTopology[],
): StructuralDiagnostic[] => {
  const diagnostics: StructuralDiagnostic[] = [];
  const roadmapById = uniqueById(roadmaps);
  const gateById = uniqueById(gates);
  const effortById = uniqueById(efforts);
  for (const roadmap of roadmaps) {
    if (roadmap.focusedGate !== null && !roadmap.gateOrder.includes(roadmap.focusedGate)) {
      diagnostics.push({
        code: "roadmap-focus-outside-gate-order",
        impact: "blocking",
        target: roadmap.locator,
        message: `Focused Gate is absent from Gate order: ${roadmap.focusedGate}.`,
      });
    }
    const focusedGate =
      roadmap.lifecycle === "active" && roadmap.focusedGate !== null
        ? gateById.get(roadmap.focusedGate)
        : undefined;
    if (focusedGate !== undefined && focusedGate.lifecycle !== "active") {
      diagnostics.push({
        code: "roadmap-focuses-non-active-gate",
        impact: "blocking",
        target: roadmap.locator,
        message: `Focused Gate must be active: ${roadmap.focusedGate}.`,
      });
    }
    for (const gateId of roadmap.gateOrder) {
      const gate = gateById.get(gateId);
      if (gate !== undefined && gate.roadmap !== roadmap.id) {
        diagnostics.push({
          code: "gate-roadmap-mismatch",
          impact: "blocking",
          target: gate.locator,
          message: `Gate declares ${gate.roadmap} but is ordered by ${roadmap.id}.`,
        });
      }
    }
  }
  for (const gate of gates) {
    const roadmap = roadmapById.get(gate.roadmap);
    if (roadmap !== undefined && !roadmap.gateOrder.includes(gate.id)) {
      diagnostics.push({
        code: "gate-missing-from-roadmap-order",
        impact: "blocking",
        target: gate.locator,
        message: `Owning Roadmap does not include Gate in Gate order: ${gate.id}.`,
      });
    }
    const contributingEffortIds = efforts
      .filter((effort) => effort.targetGate === gate.id)
      .map((effort) => effort.id);
    const orderedEffortIds = new Set(gate.effortOrder);
    const contributingEffortIdSet = new Set(contributingEffortIds);
    if (
      gate.effortOrder.length !== contributingEffortIdSet.size ||
      gate.effortOrder.some((effortId) => !contributingEffortIdSet.has(effortId))
    ) {
      diagnostics.push({
        code: "gate-effort-order-mismatch",
        impact: "blocking",
        target: gate.locator,
        message: `Gate Effort order must exactly cover current contributors: ${gate.id}.`,
      });
    }
    for (const effortId of gate.effortOrder) {
      const effort = effortById.get(effortId);
      if (effort !== undefined && effort.targetGate !== gate.id) {
        diagnostics.push({
          code: "gate-effort-order-target-mismatch",
          impact: "blocking",
          target: gate.locator,
          message: `Gate Effort order includes an Effort targeting ${effort.targetGate}: ${effortId}.`,
        });
      }
    }
    if (orderedEffortIds.size !== gate.effortOrder.length) {
      diagnostics.push({
        code: "gate-effort-order-duplicate",
        impact: "blocking",
        target: gate.locator,
        message: `Gate Effort order contains a duplicate contributor: ${gate.id}.`,
      });
    }
  }
  for (const effort of efforts) {
    const gate = gateById.get(effort.targetGate);
    if (gate !== undefined && gate.roadmap !== effort.roadmap) {
      diagnostics.push({
        code: "effort-roadmap-gate-mismatch",
        impact: "blocking",
        target: effort.locator,
        message: `Effort Roadmap ${effort.roadmap} differs from Target Gate Roadmap ${gate.roadmap}.`,
      });
    }
  }
  return diagnostics;
};

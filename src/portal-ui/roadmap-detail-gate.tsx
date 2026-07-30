import { Icons } from "./icons";
import { gateLifecycleEvents, latestPlanningLineageEvent } from "./planning-lineage-events";
import type { ProjectInspectorSelection } from "./project-inspector";
import { gateInspection, readinessLabel, sourceInspection } from "./project-roadmap-inspection";
import type { RoadmapDetailModel } from "./project-roadmap-model";
import { type Gate, RoadmapHorizon } from "./roadmap-primitives";

type Detail = Extract<RoadmapDetailModel, { state: "available" | "partial" }>;
type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
const VISIBLE_CRITERIA = 3;

export function RoadmapDetailGate({
  model,
  onInspect,
}: {
  readonly model: Detail;
  readonly onInspect: Inspect;
}) {
  const gateIndex = new Map(model.gates.map((entry) => [String(entry.gate.id), entry]));
  const visibleCriteria = model.focusedGate?.gate.exitCriteria.slice(0, VISIBLE_CRITERIA) ?? [];
  const hiddenCriteria =
    (model.focusedGate?.gate.exitCriteria.length ?? 0) - visibleCriteria.length;
  const gates: Gate[] = model.gates.map((entry) => ({
    id: entry.gate.id,
    label: `G${entry.ordinal}`,
    state: entry.gate.horizonState,
    title: entry.gate.title,
    event: latestPlanningLineageEvent(gateLifecycleEvents(entry.gate)),
  }));
  const inspectGate = (gateId: string, trigger: HTMLButtonElement) => {
    const selected = gateIndex.get(gateId);
    if (selected !== undefined) {
      onInspect(
        gateInspection(selected, model.roadmap.title, model.roadmap.gateOrder.length),
        trigger,
      );
    }
  };
  return (
    <>
      <section className="roadmap-detail-horizon" aria-labelledby="milestone-gates-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Ordered outcome horizon</p>
            <h2 id="milestone-gates-title">Milestone Gates</h2>
          </div>
        </div>
        {gates.length === 0 ? (
          <p className="scoped-copy">No trustworthy Gate horizon is available.</p>
        ) : (
          <RoadmapHorizon
            gates={gates}
            label={`${model.roadmap.title} ordered Gate horizon`}
            onSelect={(gate, trigger) => inspectGate(gate.id, trigger)}
          />
        )}
        {model.missingGateIds.length === 0 ? null : (
          <p className="projection-note">
            {model.missingGateIds.length} ordered Gate relation
            {model.missingGateIds.length === 1 ? " is" : "s are"} unavailable.
          </p>
        )}
      </section>
      {model.focusedGate === undefined ? (
        <section className="gate-contract scoped-state">
          <div>
            <p className="eyebrow">Focused Gate</p>
            <h2>No focused Gate</h2>
            <p>
              {model.roadmap.horizon === "exhausted"
                ? "This Roadmap horizon is exhausted; completion still requires an explicit Roadmap decision."
                : "Focused Gate context is unavailable in the current Snapshot."}
            </p>
          </div>
        </section>
      ) : (
        <section className="gate-contract" aria-labelledby="focused-gate-title">
          <div className="contract-summary">
            <p className="eyebrow">Focused Gate</p>
            <h2 id="focused-gate-title">
              G{model.focusedGate.ordinal} · {model.focusedGate.gate.title}
            </h2>
            <p>{model.focusedGate.gate.intent}</p>
            <span className={`readiness-state readiness-${model.focusedGate.gate.readiness}`}>
              Readiness · {readinessLabel(model.focusedGate.gate.readiness)}
            </span>
            <button
              className="source-action"
              type="button"
              onClick={(event) =>
                onInspect(
                  sourceInspection(
                    "Milestone Gate source",
                    model.focusedGate?.gate.title ?? "Focused Gate",
                    model.focusedGate?.source,
                  ),
                  event.currentTarget,
                )
              }
            >
              <Icons.source /> View Gate source
            </button>
          </div>
          <div className="contract-criteria">
            <h3>Exit criteria</h3>
            <ol>
              {visibleCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ol>
            {hiddenCriteria > 0 ? (
              <p className="criteria-note">
                {hiddenCriteria} more {hiddenCriteria === 1 ? "criterion is" : "criteria are"}{" "}
                available in full Gate context.
              </p>
            ) : null}
            <button
              className="text-action"
              type="button"
              onClick={(event) =>
                inspectGate(model.focusedGate?.gate.id ?? "", event.currentTarget)
              }
            >
              Inspect full Gate context <Icons.arrow />
            </button>
          </div>
        </section>
      )}
    </>
  );
}

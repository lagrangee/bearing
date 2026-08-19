# Canonical Mutation

## Applicability

Use for an accepted change to canonical Bearing planning state. Repository Configuration uses its
own sealed Plan and Apply journey instead.

## Authority

The Agent owns semantic meaning, materiality, candidate bytes, acceptance interpretation, direct
editing, accepted event time, and repair of its own attempted write set. Deterministic Modules own
contained reads, current revision facts, schema and reference validation, and atomic Project Read
Model publication. They do not author planning meaning.

Materiality means that accepted project meaning changed or that a current synthesis became
materially misleading. A Summary changes only for accepted new project meaning. A Brief may refresh
when accepted truth materially changes its usefulness for current orientation, but any new meaning
belongs to its actual semantic owner. Ordinary file changes, native completion, and evidence alone
are not material semantic change. Materiality decides whether a selected owner mutates its target;
it does not make the root's required post-transition owner evaluation optional.

## Operation

1. Before drafting the candidate, use `bearing inspect project --repo <repo-root>` or `bearing
   inspect <stable-planning-reference> --repo <repo-root>` to read the complete current target and
   the direct relations needed for the decision. A complete read proves coverage only. Completion:
   every affected owner and current precondition is explicit.
2. Author one complete Agent-authored candidate. Show semantic effect, rationale, relation
   consequences, exact owner write set, and preserved data. Completion: the candidate has no
   unresolved material choice.
3. Interpret acceptance. A clear direct instruction or clear acceptance of the visible complete
   candidate supplies acceptance. Ask again only for ambiguity, a new material conflict, or an
   unentailed collateral effect. Completion: accepted scope is exact or the operation stops.
4. Re-read every mutable input and target precondition immediately before editing. A changed
   precondition invalidates the candidate; do not merge silently. Completion: current revisions
   still support the accepted result.
5. Direct edit only the accepted owner files. Generate any current Source Event Time inside the
   same accepted owner operation. Completion: the exact accepted owner bytes are written and no
   other canonical file changed.
6. Immediately after editing, run `bearing inspect <stable-planning-reference> --repo <repo-root>`
   for every affected planning reference, then run `bearing inspect diagnostics --repo <repo-root>`
   once. The first post-edit inspect validates the complete schema and references and publishes the
   changed Project Read Model generation. All affected-target and diagnostics inspections read back
   that generation. Completion: affected-target inspection agrees with canonical sources in one
   committed generation and diagnostics report zero new structural defect.
7. Evaluate only the `Required`, `Consider`, and `Do not infer` guidance in each affected owner.
   Completion: required consistency effects are complete and recommendations remain recommendations.

## Guardrails

There is no generic semantic Plan or Apply, automatic confirmation, generic refresh, receipt, or
global follow-up table. A partial write is not success: preserve or restore known-good bytes,
repair only the Agent's own attempted write set, revalidate, and report the exact resumption point.
Do not infer acceptance from tests, diagnostics, provider evidence, native lifecycle, or silence.

## Completion criterion

One accepted owner-authored result matches current preconditions, only affected owners changed,
post-edit affected-target inspection reads one committed generation that agrees with canonical
sources, diagnostics report zero new structural defect, and any partial-write recovery is truthful
and scoped.

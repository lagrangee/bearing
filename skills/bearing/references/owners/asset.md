# Asset Owner

## Applicability

Use for an explicit Asset creation, identity, metadata, owner, source, or lifecycle change.

## Authority

Asset owns its durable planning identity, metadata, current owner, source, and lifecycle. A Planning
Citation is owned by the planning object that uses the Asset. Citation does not mutate Asset
metadata or lifecycle, and Asset metadata does not create Citation.

## Operation

1. Inspect the Asset reference, current owner, source facts requested for this decision, lifecycle,
   and direct planning relations. Completion: Asset identity and affected owner set are exact.
2. Author only the accepted Asset change. File existence or executor output alone is not semantic
   acceptance. Another owner participates only when root selected it because its canonical state
   will actually change.
   Completion: Asset and non-Asset effects are separated.
3. Apply through the canonical contract and inspect the Asset plus affected relations. Completion:
   identity continuity, metadata, owner, and lifecycle agree.

## After this operation

- **Required:** A changed owning planning object is validated by its own owner in the same accepted
  logical scope.
- **Consider:** Preserve semantic identity across ordinary content refinement.
- **Do not infer:** Citation, source availability, production, or Gate evidence changes Asset
  lifecycle or ownership.

## Completion criterion

Only explicitly accepted Asset semantics changed, identity remains stable where meaning continues,
and Citation effects stayed with citing owners.

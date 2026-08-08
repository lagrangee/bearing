# Asset Owner

## Applicability

Use for an explicit Asset admission, creation, identity, metadata, owner, source repair, or
lifecycle change.

## Authority

Asset owns its durable planning identity, metadata, current owner, source, and lifecycle. A Planning
Citation is owned by the planning object that uses the Asset. Citation does not mutate Asset
metadata or lifecycle, and Asset metadata does not create Citation.

Admit an Asset only when it has continuing planning value or is a first-class durable project
artifact. File existence, executor production, durability, Ticket evidence, and Gate proof do not
admit an Asset by themselves. Do not run automatic registration or classification.

## Operation

1. Inspect the Asset reference, current owner, source facts requested for this decision, lifecycle,
   and direct planning relations. For an exact local source question, use only the bounded Asset
   Detail probe. Do not use Asset lists or Attention to probe sources. Completion: Asset identity
   and affected owner set are exact.
2. For admission, state the continuing planning value or first-class artifact purpose. Author only
   `ID`, `Title`, `Purpose`, closed `Kind`, contained local or safe HTTPS `Source`, current `Owner`,
   `Added at`, lifecycle disposition, and optional human-facing `Origin`. Allowed Kinds are
   `specification`, `prototype`, `design`, `research`, `baseline`, `reference`, and `runbook`.
   Another owner participates only when root selected it because its canonical state will actually
   change.
   Completion: Asset and non-Asset effects are separated.
3. Preserve identity while meaning continues. A superseded Asset names one active replacement; an
   archived Asset does not invent a replacement. Before an Effort concludes, transfer, supersede,
   or archive each active Asset it owns. Update an affected Authority baseline in the same accepted
   logical scope. Completion: lifecycle and owner transitions are complete.
4. Apply through the canonical contract and inspect the Asset plus affected relations. A missing or
   unreadable source does not auto-archive the Asset or rematerialize the project. Completion:
   identity continuity, metadata, owner, lifecycle, and affected Authority baseline agree.

## After this operation

- **Required:** A changed owning planning object is validated by its own owner in the same accepted
  logical scope.
- **Consider:** Preserve semantic identity across ordinary content refinement.
- **Do not infer:** Citation, source availability, production, or Gate evidence changes Asset
  lifecycle or ownership. HTTPS source availability remains unverified until a separate authorized
  check exists.

## Completion criterion

Only explicitly accepted Asset semantics changed, identity remains stable where meaning continues,
Citation effects stayed with citing owners, and no file or evidence was registered automatically.

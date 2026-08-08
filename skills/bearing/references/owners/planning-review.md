# Planning Review Owner

## Applicability

Use for one pending or accepted project-wide or exact-target material decision that requires durable
coordination across one or more owners.

## Authority

Planning Review owns question framing, evidence, candidates, acceptance, rationale, and immutable
completed decision history. It coordinates other owners but never copies or takes over their
semantics.

## Operation

1. Inspect the Review, exact targets, evidence, affected owners, and equivalent pending questions.
   Set `Scope` to `project`, or set it to `exact-target` and name exactly one `Target`. Deduplicate
   by Question and Scope, including the exact Target for `exact-target`. Completion: one material
   Question, one Scope, and one deduplicated identity are explicit.
2. Author distinct candidates with consequences, preserved intent, and exact owner write sets.
   Completion: the user can accept, refine, or leave the Review pending.
3. On a clear direct instruction that accepts one candidate, apply one logical accepted scope with
   every affected owner already selected by root. Re-read all preconditions, use the canonical
   contract, and complete the Review with rationale and current accepted event time. Completion:
   Review and owner effects validate together.

## After this operation

- **Required:** Preserve completed Review history; a later question gets a new identity.
- **Consider:** Refresh material Summary or Brief only through their owners.
- **Do not infer:** Pending review accepts a candidate, and completed review automatically changes
  any owner not present in its accepted scope.
- **Do not infer:** Audit, Sync, inspection, Portal use, or evidence completion changes Review
  status.

## Completion criterion

The question is truthfully pending or explicitly accepted and completed, every changed semantic
domain retained its owner, and completed decision history is immutable.

# Project Read Model Operations

## Applicability

Use for an explicit disposable Project Read Model rebuild, an exact-scope provider baseline or
recovery, or an explicit all-Binding provider verification.

## Authority

Bearing owns the disposable Project Read Model and bounded provider acquisition. These operations
read provider-owned native state and publish evidence only; they do not choose a Work Binding,
mutate native work, or change canonical planning and lifecycle. Disposable means a later Bearing
operation can replace or rebuild the projection without losing source truth; the current published
generation remains the machine-owned result until that operation occurs.

## Operation

1. Select exactly one cost class. Rebuild uses `bearing cache rebuild --repo <repo-root>` without
   provider I/O. Exact baseline or recovery uses `bearing provider capture --scope
   <opaque-native-scope> --repo <repo-root>` with each scope taken unchanged from a current Work
   Binding. All-Binding verification uses `bearing provider verify --all --repo <repo-root>` only
   on an explicit visibly high-cost request. Completion: the selected command matches the accepted
   operation and scope.
2. Run the selected operation once and preserve its typed outcome, dispositions, missing evidence,
   and diagnostics. Do not change cost class, broaden scopes, or translate retained prior evidence
   into current evidence. Completion: the result covers only its declared operation.

## After this operation

- **Required:** A new or changed Work Binding receives its exact-scope baseline after the canonical
  change; current provider coverage starts only after capture succeeds.
- **Required:** Expected source, permission, network, format, or support unavailability after an
  accepted Binding and Activation preserves that canonical transaction and reports its exact
  recovery point. It does not roll back, retry, repair automatically, or create a temporary
  standalone fallback.
- **Required:** When Native Inspect reports `capture-required`, exact-scope capture must complete
  before Matt native mutation beyond an owner-required exact concurrency claim. A failed
  reconciliation remains failed; a later
  recovery capture restores current full-scope evidence but neither retries nor retroactively
  completes that reconciliation.
- **Do not infer:** Rebuild, capture, verification, or provider completion changes native work,
  accepts a Work Binding, activates or concludes an Effort, passes a Gate, or completes a Roadmap.

## Completion criterion

The requested cost class ran once, every selected scope came from a current Work Binding, and the
reported evidence and resumption boundary match the typed outcome without lifecycle inference.

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

1. Select exactly one cost class for the accepted operation. A ready Native Work admission needs
   no capture. Rebuild uses `bearing cache rebuild --repo <repo-root>` without provider I/O.
   Exact baseline or recovery uses `bearing provider capture --scope
   <opaque-native-scope> --repo <repo-root>` with each scope taken unchanged from a current Work
   Binding. All-Binding verification uses `bearing provider verify --all --repo <repo-root>` only
   on an explicit visibly high-cost request. Completion: the selected command matches the accepted
   operation and scope.
2. Run the selected operation once and preserve its typed outcome, dispositions, missing evidence,
   and diagnostics. Do not change cost class, broaden scopes, or translate retained prior evidence
   into current evidence. Completion: the result covers only its declared operation and records
   whether acquisition was published. This bounded operation does not impose a per-Turn limit on
   later synchronization that Native Work requires for real subsequent authorized writes.
3. When exact baseline or recovery is a prerequisite for owner work, follow complete successful
   publication with `bearing inspect --native <native-reference> --repo <repo-root>` using the
   owner continuation's exact provider-canonical subject reference. Perform this readback before
   returning to dependent implementation or native writeback. Confirm that the subject still
   resolves to the same Work Binding and captured `nativeScope`, with a `ready` Targeted
   Reconciliation Basis.
   An unavailable, changed, or non-ready readback keeps the affected continuation stopped.
   Completion: published success and matching current ready readback precede the return to
   still-authorized owner work; this internal prerequisite requires no Human Handoff.

## After this operation

- **Required:** A new or changed Work Binding receives its exact-scope baseline after the canonical
  change; current provider coverage starts only after capture succeeds.
- **Required:** Expected source, permission, network, format, or support unavailability after an
  accepted Binding and Activation preserves that canonical transaction and reports its exact
  recovery point. It does not roll back, retry, repair automatically, or create a temporary
  standalone fallback.
- **Required:** Failed, partial, unknown, or acquired-but-unpublished outcomes cannot support
  dependent work. Native Work preserves the failed scope's pending writes and same-Turn failure
  boundary. Later exact recovery preserves the prior failure and grants no additional mutation
  authority; with success and unchanged relevant preconditions, an already-authorized request may
  continue. Publication concurrency protects the Project Read Model generation, not canonical files
  for the duration of the composed request.
- **Do not infer:** Rebuild, capture, verification, or provider completion changes native work,
  accepts a Work Binding, activates or concludes an Effort, passes a Gate, or completes a Roadmap.

## Completion criterion

The requested cost class ran once, every selected scope came from a current Work Binding, and the
reported evidence and resumption boundary match the typed outcome without lifecycle inference.
A baseline-dependent owner return also has a matching current Binding and ready-basis readback
after successful publication and before any resumed dependent work.

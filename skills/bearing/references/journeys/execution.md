# Execution

## Applicability

Use when the user directly invokes an executor or asks to implement an exact Delivery Ticket.

## Authority

The executor owns implementation, tests, review, commit, and its outcome. Work Management owns
native writeback. Bearing owns relevant planning context, directly entailed Effort activation, and
exact reconciliation of successful managed native effects.

## Operation

1. Continue the original executor command in the same visible operation; never ask the user to
   invoke it again. Resolve one exact Ticket, its acceptance criteria and blockers, and run local
   Binding lookup for its native scope.
2. For bound work, inspect the affected Effort. An explicit request to execute an unambiguous Ticket
   under a planned Effort directly entails its activation: state the effect, change the Effort
   through the canonical mutation contract, inspect the Effort, then continue execution without
   duplicate confirmation. An active Effort continues directly.
3. If the user refuses the entailed activation, perform no Effort, executor, or native mutation. A
   concluded Effort never reopens implicitly; stop for an accepted new, superseding, or Binding
   disposition decision.
4. Run the executor with relevant planning context and preserve its outcome. If native writeback
   follows, hand the accepted outcome to Native Work and preserve its separate terminal outcome.
   Execution does not restate or override Native Work transaction closure or readback.
5. For materially related unbound work, execution still proceeds. Offer a planning recommendation
   only after the work outcome and never require enrollment.

## After this operation

- **Required:** Preserve truthful executor and native outcomes, including every nonterminal stage
  and exact resumption point.
- **Consider:** Evidence-backed Effort, Gate, or Roadmap opportunities may be offered through their
  owners.
- **Do not infer:** Execution failure, native completion, reconciliation success, provider
  completion, and tests do not conclude an Effort, pass a Gate, or complete a Roadmap. A lifecycle
  mismatch reports facts only; it never chooses repair, invents event time, activates, reopens, or
  changes a Binding.

## Completion criterion

The original executor command ran once in visible context, lifecycle effects were explicit and
accepted, and executor and Native Work owners retained their truthful separate outcomes.

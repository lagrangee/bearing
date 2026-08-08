# Execution

## Applicability

Use when the user directly invokes an executor or asks to implement an exact Delivery Ticket.

## Authority

The executor owns implementation, tests, review, commit, and its outcome. Work Management owns
native writeback. Bearing owns relevant planning context, directly entailed Effort activation, and
exact reconciliation of successful managed native effects.

## Operation

1. Continue the original executor command in the same visible operation; never ask the user to
   invoke it again. Resolve one exact Ticket and run local Binding lookup. Completion: Ticket,
   acceptance criteria, blockers, native scope, and bound or unbound fact are explicit.
2. For bound work, inspect the affected Effort. An explicit request to execute an unambiguous Ticket
   under a planned Effort directly entails its activation: state the effect, apply and inspect it,
   then continue execution without duplicate confirmation. An active Effort continues directly.
   Completion: lifecycle is valid for execution.
3. If the user refuses the entailed activation, perform no Effort, executor, or native mutation. A
   concluded Effort never reopens implicitly; stop for an accepted new, superseding, or Binding
   disposition decision. Completion: refusal or concluded state has no hidden effect.
4. Run the executor with relevant planning context and preserve its outcome. Then let Work
   Management perform any native writeback and use exact reconciliation for successful bound
   effects. Completion: implementation and native outcomes remain owner-separated.
5. For materially related unbound work, execution still proceeds. Offer a planning recommendation
   only after the work outcome and never require enrollment. Completion: standalone execution is
   not blocked by governance.

## After this operation

- **Required:** Reconcile exact successful bound native writes; preserve every nonterminal stage.
- **Consider:** Evidence-backed Effort, Gate, or Roadmap opportunities may be offered through their
  owners.
- **Do not infer:** A lifecycle mismatch reports facts only. It never chooses repair, invents event
  time, activates, reopens, concludes, or changes a Binding.

## Completion criterion

The original executor command ran once in visible context, lifecycle effects were explicit and
accepted, execution and native owners retained their outcomes, and reconciliation stayed exact.

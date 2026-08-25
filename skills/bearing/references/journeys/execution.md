# Execution

## Applicability

Use when the user directly invokes an executor or asks to implement an exact Delivery Ticket.

## Authority

The executor owns implementation, tests, review, commit, and its outcome. Work Management owns
native writeback. Bearing owns relevant planning context, directly entailed Effort activation, and
exact reconciliation of successful managed native effects.

## Operation

1. Continue the original executor command in the same visible operation; never ask the user to
   invoke it again. Resolve one exact Ticket, its acceptance criteria and blockers, and inspect any
   existing native scope and Binding. Preserve a direct executor invocation that instead names one
   exact planned Effort whose native identity does not exist yet.
2. For a planned Effort with no Work Binding, state the combined effect and join the exact start
   owners selected at the root. Do not assume a Binding, fabricate a native identity, or copy their
   sequence. Those owners preserve the user-invoked workflow, obtain its exact native scope, create
   the Binding and Activation atomically, and capture the first provider baseline before execution
   continues. Active bound work continues directly.
3. If the user refuses the stated start effect, perform no Effort, executor, or native mutation. A
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

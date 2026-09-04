# Native Work

## Applicability

Use when the request creates, identifies, or changes provider-native work, including an explicitly
invoked owner Skill, ordinary owner work, and native writeback after Execution.

## Working terms

- An **Owner Skill** is a Skill the Human actually invoked for this work. Preserve its workflow and
  authority. When none was invoked, perform **Ordinary Owner Work** without claiming Skill use.
- A **Human Handoff** pauses owner work for one material Human choice or authorization. It is not
  completion or failure.
- **Workflow Completion** means the current owner task is fulfilled. It does not imply provider,
  Effort, Gate, or Roadmap completion.
- The **Pending Native Write Set** is every exact native subject successfully changed in this
  request and not yet covered by successful provider synchronization. A changed relation or pointer
  includes both known endpoints.

## Authority

Work Management owns native status, claim, blocker, dependency, checklist, Answer, and resolution.
The Agent owns exact admission and the Pending Native Write Set.
Deterministic Bearing Modules own Binding lookup, provider acquisition, and exact reconciliation.
Provider reads never mutate native work.

## Native claim boundary

Claim is an owner-specific concurrency operation, not a generic Native Work step. Preserve the
selected owner's exact claim representation; never translate Wayfinder's `claimed` state into a
Delivery ticket lifecycle or triage state.

| Owner mode | Claim authority |
| --- | --- |
| `invoked-owner-workflow-with-required-claim` | `exact-owner-defined-claim-only` |
| `ordinary-owner-work` | `none` |
| `owner-workflow-without-claim` | `none` |

## Operation

1. Preserve an actually invoked Owner Skill and its original request. Otherwise use Ordinary Owner
   Work from the natural request and repository contract.
2. Admit every existing native subject before owner mutation; a Binding scope identifies the
   provider boundary but is not itself a native subject. An invoked owner whose contract requires a
   claim may perform only that exact claim first; all other work performs no pre-admission mutation.
   Resolve ambiguity with the Human. For Local Markdown, use the exact repository-relative tracker
   locator unchanged as `<native-reference>` and keep provider identity separate. A bare GitHub issue
   number or `#number` is a tracker locator: resolve it with
   `gh issue view <number> --json url --jq .url`, then use the returned URL unchanged as
   `<native-reference>`. Run `bearing inspect --native <native-reference> --repo <repo-root>` and
   preserve its canonical `result.reference` and Binding. For a bound subject, also preserve its
   `nativeScope` and Targeted Reconciliation Basis. If the basis is `capture-required`, complete one
   exact-scope baseline and end the current Turn without owner mutation; continue the preserved owner
   work after the next Human reply. That capture is the Turn's one provider synchronization. If the
   basis is `ready`, perform no baseline capture. A confirmed named Effort start with no native
   identity instead lets its accepted owner workflow create the real scope.
3. Run the owner workflow in the same conversation until Human Handoff, Workflow Completion, or
   Workflow Failure. Add only actual successful writes to the Pending Native Write Set; requested,
   attempted, or rolled-back writes add nothing.
4. Apply the matching provider follow-up before replying:

| Owner state | Provider follow-up |
| --- | --- |
| `human-handoff` | Preserve the owner workflow, scope, and pending writes for the next Turn; this Turn may perform zero or one exact reconciliation. |
| `workflow-complete; existing-binding; pending-native-write-set-present` | Reconcile the complete pending set once before reporting completion. |
| `workflow-complete; accepted-new-binding` | Let the Effort owner create the Binding and Activation, then establish the first baseline with one exact-scope capture. |
| `workflow-complete; unbound-native-work` | Preserve the standalone result, then apply the Enrollment Boundary. |
| `workflow-complete; no-pending-native-write-set` | Perform no provider synchronization. |
| `workflow-failed` | Preserve partial effects and the exact resumption point; perform no post-owner provider follow-up. |

5. For an existing Binding, reconcile with `bearing reconcile-native --repo <repo-root>
   --scope <opaque-native-scope>` and one unchanged provider-canonical `--ref` for each pending
   subject. Retain the complete typed result and clear only covered subjects after success. A later
   Turn may synchronize new writes once; the same Turn never repeats synchronization to discover
   fields, change references, or recover a failure.
6. Standalone Native Work never waits for enrollment. Complete its owner workflow first, then make
   at most the advisory suggestion allowed below.

## Enrollment Boundary

| Evidence | Native disposition | Bearing continuation |
| --- | --- | --- |
| `no-direct-high-confidence-relationship` | `standalone` | `no-suggestion-or-enrollment` |
| `direct-high-confidence-existing-planned-effort` | `standalone` | `at-most-one-advisory-suggestion; no-enrollment-without-acceptance` |
| `direct-high-confidence-useful-new-effort` | `standalone` | `at-most-one-advisory-suggestion; no-enrollment-without-acceptance` |
| `semantic-similarity-only` | `standalone` | `no-enrollment-or-activation` |
| `artifact-existence-only` | `standalone` | `no-enrollment-or-activation` |
| `provider-lifecycle-only` | `standalone` | `no-enrollment-or-activation` |
| `provider-completion-only` | `standalone` | `no-enrollment-or-activation` |
| `tests-only` | `standalone` | `no-enrollment-or-activation` |
| `capture-only` | `standalone` | `no-enrollment-or-activation` |
| `reconciliation-only` | `standalone` | `no-enrollment-or-activation` |
| `portal-observation-only` | `standalone` | `no-enrollment-or-activation` |

## After this operation

- **Required:** A failed targeted reconciliation stops at its exact resumption point with prior
  evidence non-current; there is no full-scope capture or verification fallback in that native
  Turn. Any later exact-scope capture is a separate recovery operation and cannot retroactively
  prove the failed reconciliation succeeded.
- **Consider:** A lifecycle-mismatch diagnostic may support a later Effort decision.
- **Do not infer:** Evidence-only rows in the Enrollment Boundary do not create a Binding, activate
  or conclude an Effort, pass a Gate, complete a Roadmap, or supply event time.

## Completion criterion

The actual owner was preserved, every existing native subject completed exact admission, and each owner
boundary applied its matching provider follow-up to the complete Pending Native Write Set.

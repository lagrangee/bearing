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
  Effort, Gate, or Roadmap completion, or end a request with authorized owner work still remaining.
- The **Pending Native Write Set** records this request's actual successful native writes that
  successful synchronization has not yet covered. It includes every changed subject's exact
  provider-canonical reference and both known endpoints of a changed relation or pointer.
  Requested, failed, rolled-back, or unchanged writes add nothing.

## Authority

Work Management owns native status, claim, blocker, dependency, checklist, Answer, and resolution.
The Agent owns exact admission and the Pending Native Write Set.
The Project Read Model operation selected and loaded by root owns baseline and recovery acquisition.
Deterministic Bearing Modules own Binding lookup, provider acquisition, and exact reconciliation.
Provider reads never mutate native work.

The current Matt workflow and confirmed repository tracker contract define native writing. A
Delivery scope may contain Tickets without a Spec when its source is a plan or conversation.
Scope membership alone does not establish parentage. Create or update a related subject only when
the authorized owner workflow requires it, not to satisfy a Provider's reading assumptions.

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
   Work from the natural request and repository contract. Select work-management rules for the
   actual artifact and workflow: ordinary Delivery uses its Delivery status and writeback rules;
   a shared tracker's Wayfinding section governs Wayfinding work. Shared ticket storage does not
   transfer that workflow's claim authority or status vocabulary to Delivery.
2. Admit every existing native subject before owner mutation, including subjects reached later in
   owner work; a Binding scope identifies the provider boundary but is not itself a native subject.
   Begin here again after a Human Handoff: repeat Native Inspect for the targets of the resumed
   work before writing, while retaining the owner, existing claim, and pending writes.
   An invoked owner whose contract requires a claim may perform only that exact claim first;
   all other work performs no pre-admission mutation.
   Resolve ambiguity with the Human. For Local Markdown, use the exact repository-relative tracker
   locator unchanged as `<native-reference>` and keep provider identity separate. A bare GitHub issue
   number or `#number` is a tracker locator: resolve it with
   `gh issue view <number> --json url --jq .url`, then use the returned URL unchanged as
   `<native-reference>`. Run `bearing inspect --native <native-reference> --repo <repo-root>` and
   preserve its canonical `result.reference` and Binding. For a bound subject, also preserve its
   `nativeScope` and Targeted Reconciliation Basis. A `ready` basis requires no capture. A
   `capture-required` admission depends on the selected Project Read Model operation's successful
   return with published baseline evidence and a current ready Binding. Preserve the exact scope
   and owner continuation while that operation completes within the same request; this prerequisite
   is not a Human Handoff. A confirmed named Effort start with no native
   identity lets its accepted owner workflow create the real scope. A new Binding or directory
   name alone does not prove that its underlying native subjects are new.
3. Continue the selected owner workflow for the original request in the same conversation. Admit
   each additional existing subject through operation 2 before its first mutation, including a
   parent Map or Spec reached during owner follow-up.
   Record each successful native file or subject change as it occurs. The original Ticket is an
   entry target, not the complete write set; preserve the Pending Native Write Set across inner
   Skill returns, owner boundaries, and Human Handoffs.
   Before declaring Workflow Completion, evaluate parent or related-subject follow-up required by
   the selected owner workflow or repository contract, then complete its authorized writeback.
   Limit that follow-up to the original request and those contract-required relationships. Closing
   the entry Ticket or finishing an inner Skill returns to these remaining owner steps, not directly
   to synchronization. Workflow Completion requires every applicable owner step and authorized
   writeback to be finished. Run until Workflow Completion, Human Handoff, Workflow Failure, or real
   scope establishment for an accepted named Effort start, then apply operation 4.
   Ordinary iteration inside unfinished owner work is not Workflow Failure. Before synchronization,
   the owner may correct its own writes within the existing authorization and confirmed tracker
   contract; a compatible Provider read does not broaden the writer contract.
4. Continue from the actual owner boundary. Before baseline-dependent work or further canonical effects,
   recheck their relevant preconditions. A changed Binding, Provider, or Effort lifecycle stops the
   affected continuation; a stale canonical candidate cannot silently merge.

| Owner state | Provider follow-up |
| --- | --- |
| `human-handoff` | Preserve the owner workflow, scope, pending writes, and resumption point. By default, ask the Human directly and retain claim or partial writes unsynchronized. Synchronize through operation 5 only after identifying the current observation needed for that material decision; a pending claim or ending the Turn alone is not a reason. After the Human decision, resume at operation 2 before owner mutation. |
| `scope-created-or-identified; accepted-new-binding` | Require the Effort owner's combined Binding and Activation, then the selected Project Read Model operation's successful baseline return before resuming operation 3. |
| `workflow-complete` | First return to operation 3 for any remaining authorized owner work in the composed request. Once none remains, reconcile each confirmed Binding/scope's complete bound pending set through operation 5. Preserve any standalone result and apply operation 7. With no pending writes, perform no provider synchronization. |
| `workflow-failed` | Preserve partial effects and the exact resumption point; perform no post-owner provider follow-up. |

5. Before reconciliation, enumerate the pending subjects from this request's successful native
   writes and saved source changes, including every known endpoint of changed relations or pointers.
   For each entry, identify its exact provider-canonical reference and the successful write or
   endpoint requiring observation. Exclude writes already covered by successful synchronization.
   Git status proves neither completeness nor authorship; native files may be ignored, and
   unrelated concurrent edits belong to their own request. Group bound entries by their admission's
   confirmed Binding and exact scope. Reconcile each group once, deriving every repeated `--ref`
   argument from that group's complete reference list unchanged. Compare the returned request
   subjects, dispositions, and readback with the inventory before clearing covered writes or
   reporting synchronized completion. Preserve the typed outcome and retain every entry without
   successful current coverage. A first capture can cover earlier writes; those writes need no second
   synchronization.
   One scope's success covers neither another scope nor unbound work. At a handoff, identify native
   facts not yet reflected in Bearing.

   For example, authorized work changes a Ticket's Answer and its existing Map's pointer to that
   Ticket. Admit both subjects before their writes. After both writes succeed in one Binding/scope,
   the inventory contains the Ticket reference for the Answer and the Map reference for the pointer.
   That group's call uses both references:

   ```sh
   bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope> \
     --ref <ticket-canonical-reference> --ref <map-canonical-reference>
   ```

   A successful result covering only the Ticket leaves the Map entry pending.
6. A successful synchronization followed by a necessary, still-authorized native semantic or
   evidence change creates a new obligation, including a later change to the same subject. There is
   no global per-Turn acquisition limit. Preserve the concrete prior success and later change;
   identical-byte rewrites, meaningless timestamps or state toggles, and splitting already-known
   work do not justify another call. New writes never reset an earlier failed or unknown result.
7. Standalone Native Work never waits for enrollment. Complete its owner workflow first, then make
   at most the advisory suggestion allowed below.

## Enrollment Boundary

| Evidence | Native disposition | Bearing continuation |
| --- | --- | --- |
| `no-direct-high-confidence-relationship` | `standalone` | `no-suggestion-or-enrollment` |
| `direct-high-confidence-existing-planned-effort` | `standalone` | `at-most-one-advisory-suggestion; no-enrollment-without-acceptance` |
| `direct-high-confidence-useful-new-effort` | `standalone` | `at-most-one-advisory-suggestion; no-enrollment-without-acceptance` |
| `semantic-similarity-only`; `artifact-existence-only`; `provider-lifecycle-only`; `provider-completion-only`; `tests-only`; `capture-only`; `reconciliation-only`; `portal-observation-only` | `standalone` | `no-enrollment-or-activation` |

## After this operation

- **Required:** Failed, partial, or unknown first capture retains the accepted Binding and active
  Effort and stops baseline-dependent work. Failed, partial, or unknown reconciliation retains the
  pending set and truthful evidence limits. In that Turn, the failed scope receives no retry, changed
  references or cost class, full capture or verification fallback, or reset through repair or new
  writes. Read-only diagnosis remains available.
- **Required:** Later recovery has its own exact purpose and preserves the historical failure. It
  grants no mutation authority; success may continue an original request that remains authorized.
  An acquired but unpublished result remains unpublished. Project Read Model publication protects
  its generation, not canonical files throughout the request.
- **Consider:** A lifecycle-mismatch diagnostic may support a later Effort decision.
- **Do not infer:** Evidence-only rows in the Enrollment Boundary do not create a Binding, activate
  or conclude an Effort, pass a Gate, complete a Roadmap, or supply event time.

## Compatibility reporting

Public and Development use the same Provider interpretation and recovery boundaries. Safe read
normalization requires no native rewrite or user action; continue the authorized workflow without
asking Public users to classify edge cases or maintain a compatibility matrix.

When synchronization remains incomplete, report which native work was saved, what Bearing did or
did not publish, what remains unavailable, and the exact resumption point. Distinguish native
format evidence from acquisition failure, an unavailable basis, and a publication conflict; a
Provider rejection alone does not prove a native contract violation.

Preserve readable native facts separately from missing optional metadata and completion evidence.
An observed tracker closure is not proof of completed acceptance; an undeclared Map or Spec
lifecycle is not an authored active or draft state. Provider limitations authorize neither extra
native fields nor changes to the user's Matt installation or tracker contract.

In Development, make observed compatibility cases inspectable through their affected native
references and available raw facets, normalization evidence, or typed failure evidence. Reporting
detail grants no additional repair or retry authority and never changes the original outcome.

## Completion criterion

The actual owner and authorized continuation were preserved, every existing native subject completed
exact admission, and each confirmed scope's complete pending set is covered by successful observation
or retained at a truthful handoff or failure boundary.

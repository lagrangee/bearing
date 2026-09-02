# Native Work

## Applicability

Use when the user invokes Work Management to create or identify native work, or after any known
native write that may be inside an accepted Work Binding.

## Authority

Work Management owns native status, claim, blocker, dependency, checklist, Answer, and resolution.
Bearing owns local Binding lookup, relevant planning context, and exact readback of successful
managed effects. Provider reads never mutate native work.

## Operation

1. Resolve the exact native reference when it already exists. If the request can identify more than
   one plausible reference, stop and ask the Human to select the exact identity. Do not batch,
   order, claim, or execute any approximate candidate. When an exact planned-Effort start has no
   native identity yet, accept only the Effort owner's confirmed named handoff; do not predict or
   fabricate the future scope. A bare GitHub issue number or `#number` is a tracker locator, not a
   provider-canonical native reference. Resolve it with
   `gh issue view <number> --json url --jq .url`, use that returned URL unchanged as
   `<native-reference>`, and never pass the tracker locator. Every existing target then runs Native
   Inspect through `bearing inspect --native <native-reference> --repo <repo-root>`. Preserve the
   canonical `result.reference` returned by Inspect exactly as returned;
   do not absolutize, relativize, normalize independently, or reconstruct it from filesystem
   knowledge. For a bound result, preserve its `nativeScope` and Targeted Reconciliation Basis.
   When the basis is `capture-required`, complete the selected exact-scope baseline operation before
   Work Management starts; a failed capture stops without native mutation. Completion: the target is
   a confirmed named start with no scope yet, unbound, or bound to one Effort with a `ready` basis.
2. Give Work Management the original request that explicitly invoked its Matt workflow. Let it
   complete its full owner operation before returning control, including provider-specific final
   review. Preserve one terminal outcome, the exact scope identity it created or identified, and
   every native subject it confirms it successfully wrote. For a successful relation mutation,
   include its known source and target subjects. Bearing never invokes, emulates, or replaces the
   workflow and does not require a Bearing receipt, provider-neutral candidate write set, or
   relation `kind`/`source`/`target` payloads. Do not translate failed, ambiguous, incomplete, or
   spec-only results. Completion: the owner operation is terminal and its actual successful scope
   and subject set are exact.
3. When that owner transaction supplies the scope for a new Work Binding, return its exact identity
   to the Effort owner. After the canonical Binding and Activation transaction, use one Provider
   Scope Capture as the first baseline; do not substitute Targeted Native Reconciliation. The
   accepted named invocation authorizes this continuation without duplicate confirmation.
4. For an existing Binding, only after the Matt Native Work Transaction closes, deduplicate its
   complete actual successful set and run exactly one Targeted Native Reconciliation through
   `bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope>` with one exact
   `--ref` for each subject. Check complete subject closure before issuing the command, and use each
   provider-canonical native reference unchanged. Admit only an unchanged `result.reference` from
   Native Inspect or a provider-canonical reference returned by Work Management for its successful
   write. Never synthesize a subject alias from an issue number, path knowledge, title, or opaque
   scope identity; reconciliation is not a payload probe. Provider readback derives current
   relations and their direction. The accepted native outcome authorizes this exact readback
   without another confirmation. Any issued reconciliation command is the sole attempt: failure is
   terminal, not authority for a corrected second command. Completion: one post-transaction result
   covers the complete deduplicated subject set and only provider-proven relations.
5. If work is unbound, complete Work Management as Standalone Native Work before Bearing considers
   enrollment, then apply the Enrollment Boundary below. Native work never waits for enrollment.
   Completion: the terminal native disposition and bounded Bearing continuation match the table.

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
  transaction. Any later exact-scope capture is a separate recovery operation and cannot
  retroactively prove the failed transaction succeeded.
- **Consider:** A lifecycle-mismatch diagnostic may support a later Effort decision.
- **Do not infer:** Evidence-only rows in the Enrollment Boundary do not create a Binding, activate
  or conclude an Effort, pass a Gate, complete a Roadmap, or supply event time.

# Native Work

## Applicability

Use for Work Management actions or after any known native write that may be inside an accepted Work
Binding.

## Authority

Work Management owns native status, claim, blocker, dependency, checklist, Answer, and resolution.
Bearing owns local Binding lookup, relevant planning context, and exact readback of successful
managed effects. Provider reads never mutate native work.

## Operation

1. Resolve the exact native reference. If the request can identify more than one plausible native
   reference, stop and ask the Human to select the exact identity. Do not batch, order, claim, or
   execute any approximate candidate. Then run `bearing inspect --native <native-reference> --repo
   <repo-root>`. Completion: the local result is bound to one Effort or explicitly unbound.
2. Give Work Management the original request. Let it complete its full owner operation before it
   returns control. Preserve one terminal outcome plus the actual successfully affected native
   subjects and relations. Do not define or validate a provider-neutral candidate write set, and
   do not translate failed, ambiguous, incomplete, or spec-only results. Completion: the owner
   operation is terminal and its actual successful set is exact.
3. Only after the Matt Native Work Transaction closes, deduplicate its complete actual successful
   set and run one Targeted Native Reconciliation through `bearing reconcile-native --repo
   <repo-root> --scope <opaque-native-scope>` with exact `--ref` and `--relation` values. The
   accepted native outcome authorizes this exact readback without another confirmation.
   Completion: one post-transaction result covers the complete deduplicated set.
4. If work is unbound, complete Work Management normally. Offer at most one material planning
   recommendation when evidence supports it; enrollment is not a prerequisite. Completion: the
   recommendation is accepted later by an owner or the work remains standalone.

## After this operation

- **Required:** A failed targeted reconciliation stops at its exact resumption point with prior
  evidence non-current; there is no full-scope capture or verification fallback.
- **Consider:** A lifecycle-mismatch diagnostic may support a later Effort decision.
- **Do not infer:** Native completion, reconciliation success, provider completion, and tests do
  not activate or conclude an Effort, pass a Gate, complete a Roadmap, create a Binding, or supply
  event time.

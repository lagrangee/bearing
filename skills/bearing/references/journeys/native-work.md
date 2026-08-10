# Native Work

## Applicability

Use for Work Management actions or after any known native write that may be inside an accepted Work
Binding.

## Authority

Work Management owns native status, claim, blocker, dependency, checklist, Answer, and resolution.
Bearing owns local Binding lookup, relevant planning context, and exact readback of successful
managed effects. Provider reads never mutate native work.

## Operation

1. Resolve the exact native reference and run `bearing inspect --native <native-reference>
   --repo <repo-root>`. Completion: the local result is bound to one Effort or explicitly unbound.
2. Give Work Management the original request and preserve its contract and outcome. Do not translate
   failed, ambiguous, incomplete, or spec-only results. Completion: native owner effects and
   affected subjects/relations are exact.
3. After a successful write inside an accepted Binding, deduplicate only the successfully affected
   entities and relations and run `bearing reconcile-native --repo <repo-root> --scope
   <opaque-native-scope>` with exact `--ref` and `--relation` values. Completion: readback and
   publication result cover that exact set. The accepted native outcome authorizes this exact
   reconciliation; the product seam change does not require another confirmation.
4. If work is unbound, complete Work Management normally. Offer at most one material planning
   recommendation when evidence supports it; enrollment is not a prerequisite. Completion: the
   recommendation is accepted later by an owner or the work remains standalone.

## After this operation

- **Required:** A failed targeted reconciliation stops at its exact resumption point with prior
  evidence non-current; there is no full-scope capture or verification fallback.
- **Consider:** A lifecycle-mismatch diagnostic may support a later Effort decision.
- **Do not infer:** Native completion does not activate or conclude an Effort, pass a Gate, complete
  a Roadmap, create a Binding, or supply event time.

## Completion criterion

Work Management retained native authority, each successful bound write had one exact
reconciliation result, failures did not expand cost, and unbound work stayed usable.

# Repository Configuration

## Applicability

Use with exactly one root-selected lifecycle variant for Fresh activation, Active change or repair,
reactivation, deactivation, or Invalid or Unsupported diagnosis.

Repository schema 2 requires an explicit `runtime` identity. Normal public Stable Repository
Configuration writes `runtime` as `stable`; the coherent source-repository Development Runtime
writes `runtime` as `development`. Do not ask the Human to choose an internal migration mode, and
never default, fall back, or silently convert between these targets.

## Authority

The Agent owns the dialogue, product choices, executor assessment, and user-facing review.
Deterministic Configure owns machine facts, a sealed exact plan, precondition validation, managed
pointer updates, rollback, and repository validation. Work Management owns its prerequisite;
Catalog and Portal remain independent owners.

## Operation

1. Run `bearing configure inspect --repo <repository-root>` and report lifecycle, current
   selections, installed capability evidence, path safety, and Catalog availability. Completion:
   every presented fact comes from typed inspection.
2. Conduct a dynamic dialogue with one material choice at a time. Preserve already accepted choices
   across assisted prerequisite work and same-visible continuation. Completion: each required
   choice is accepted, explicitly skipped where allowed, or unresolved and visible.
3. Keep executor choice unresolved until the user nominates one or explicitly skips. Ask exactly
   once before final review when neither occurred. Explain an invalid, ambiguous, unavailable, or
   supporting-only nomination once; reconsider only after materially new evidence. Completion: the
   executor choice is nominated and validated, or explicitly skipped.
4. Let the owning capability complete a missing Matt prerequisite, then resume this same dialogue
   with prior choices intact. Refusal or failed prerequisite performs no Bearing repository write.
   Completion: the prerequisite is valid or Configuration stops at its owner.
5. Run `bearing configure plan` only after all material choices resolve. Present one owner-separated
   final review with completed prerequisite effects, the exact repository Apply Unit, preservation
   effects, and later independent Catalog effect. Completion: the user accepts that complete review
   or Configuration changes nothing.
6. Run `bearing configure apply` with the same sealed plan and choices. Do not reinterpret intent.
   Validate the repository outcome and actual changed targets against the accepted Apply Unit.
   Completion: the repository result and preservation effects are verified.
7. Finish the user-facing response with the repository result, independent Catalog result (including
   no-op or failure), and the actionable Portal handoff below. This is also the final step of an
   Active repair. Completion: the response states all three outcomes and any remaining independent
   stage. Give the instruction to the Human; never start or restart Portal yourself.

| Returned Portal evidence | Final response |
| --- | --- |
| `compatible` | Give the returned exact `projectUrl`. |
| `absent` | Say Portal is not running and tell the Human to run `bearing portal` in a separate terminal, keeping it in the foreground. |
| `incompatible` | Tell the Human to stop the existing Host, then run the current Kit's `bearing portal` in a separate terminal. |
| No Portal handoff returned | State that no Portal handoff was obtained; preserve any reported Catalog failure and its independent resumption. |

## After this operation

- **Required:** Resume only the incomplete independent stage after a partial outcome; never replay a
  valid repository Apply.
- **Consider:** Offer Project Orientation only when the Fresh variant permits it.
- **Do not infer:** Configuration success does not create planning, acquire provider scope, select an
  executor default, or prove Portal availability.

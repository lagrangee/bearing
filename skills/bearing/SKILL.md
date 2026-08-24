---
name: bearing
description: Use only for explicit Bearing invocation or when the current repository's Repository Configuration managed pointer nominates Bearing for this request; otherwise use normal Agent behavior.
---

# Bearing

Coordinate project governance, Repository Configuration, native work, and execution through one
public Agent surface.

## Entry and runtime selection

The Repository Configuration managed pointer is the sole authority for contextual nomination. Use
it only under its stated conditions; repository presence does not nominate Bearing. Explicit
Bearing invocation remains available when the pointer did not nominate the request.

Select the CLI from the managed pointer. Replace the leading `bearing` token in every command below
with that CLI. Stable Runtime uses `$HOME/.bearing/bin/bearing`. Development Runtime uses
`node <repo-root>/dist/cli.js`; first run its `runtime inspect --repo <repo-root>` operation and
require one coherent Development receipt. Development never falls back to Stable CLI, Skill, or
state. Each functional operation validates its required Repository Integration Lifecycle before
cache creation, provider I/O, or mutation.

All runtime reference paths below are relative to this `SKILL.md`. Load only the direct references
selected for the current operation.

Treat an applied Global Kit Install, Update, or Repair, or a coherent Development receipt with a
different runtime identity or source provenance, as a new runtime contract. Re-read this
`SKILL.md` completely and every already-selected direct reference before the next functional
operation. A no-op, failed, or rolled-back transition does not change the loaded contract.

## Universal invariants

- The Agent owns semantic meaning, judgment, acceptance interpretation, canonical content, and
  scoped repair of its own attempted write set. Deterministic Bearing Modules own contained reads,
  schema and reference validation, exact reconciliation, projection, and typed diagnostics.
- Work Management owns native status, claim, blockers, dependencies, checklists, Answer, and
  resolution. Execution owns implementation, tests, review, commit, and its outcome. Portal is
  read-oriented and authorizes no canonical or native mutation.
- Acquire only decision-relevant current evidence. Do not infer completeness, authority, scope, or
  lifecycle from repository scans, title matches, tests, receipts, diagnostics, native completion,
  provider completion, or Portal observation.
- Preserve typed failures, partial results, unavailable evidence, and exact resumption points. Do
  not expand scope, invent recovery, or translate failure into success.
- A complete visible candidate can be accepted directly. Ask again only for ambiguity, a material
  conflict, or an unentailed collateral effect. Use the current user's language for user-visible
  content; keep Agent-facing contracts in English.

## Semantic command table

| Meaning | Command form |
| --- | --- |
| Repository Configuration state | `bearing configure inspect --repo <repo-root>` |
| Sealed Repository Configuration candidate | `bearing configure plan <accepted-arguments>` |
| Accepted sealed Repository Configuration change | `bearing configure apply <accepted-arguments> --plan-token <token>` |
| Project Context | `bearing inspect project --repo <repo-root>` |
| One planning target | `bearing inspect <stable-planning-reference> --repo <repo-root>` |
| One native target and local Binding | `bearing inspect --native <native-reference> --repo <repo-root>` |
| Current deterministic diagnostics | `bearing inspect diagnostics --repo <repo-root>` |
| Exact readback of successful managed native effects | `bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope> --ref <native-reference> [--ref <native-reference>]` |
| Exact Work Binding provider baseline | `bearing provider capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] --repo <repo-root>` |
| Explicit all-Binding provider verification | `bearing provider verify --all --repo <repo-root>` |
| Disposable Project Read Model rebuild | `bearing cache rebuild --repo <repo-root>` |
| Project Catalog operation | `bearing catalog <catalog-operation> <accepted-arguments>` |
| Foreground Portal Host | `bearing portal [--port <1-65535>]` |

Commands return typed outcomes. `complete` proves only the coverage declared by that operation; it
does not prove readiness, acceptance, lifecycle transition, or mutation authority.

## Direct reference routing

| Operation | Load directly |
| --- | --- |
| Accepted canonical semantic mutation | `references/contracts/canonical-mutation.md` plus each affected semantic owner below |
| Repository Configuration | `references/journeys/configure.md` plus exactly one of `references/journeys/configure-fresh.md`, `references/journeys/configure-active.md`, `references/journeys/configure-reactivate.md`, `references/journeys/configure-deactivate.md`, or `references/journeys/configure-unsupported.md` |
| Repository Update | `references/journeys/update.md` and `references/journeys/project-read-model.md` |
| Project Catalog | `references/journeys/catalog.md` |
| Project Read Model rebuild, provider capture, or provider verification | `references/journeys/project-read-model.md` |
| Project Orientation | `references/journeys/project-orientation.md`; also `references/journeys/scope-review.md` when existing-work evidence is included |
| Whole-project Scope Review | `references/journeys/scope-review.md` |
| Feature Intake with a material accepted commitment or planning opportunity | `references/journeys/feature-intake.md` |
| Native Work | `references/journeys/native-work.md`; also `references/journeys/project-read-model.md` when Native Inspect reports `capture-required` |
| Direct Execution | `references/journeys/execution.md` and `references/journeys/native-work.md`; also `references/journeys/project-read-model.md` when Native Inspect reports `capture-required` |
| Explicit Next Work guidance | `references/journeys/next-work.md` |
| Project Summary | `references/owners/project-summary.md` |
| Project Brief | `references/owners/project-brief.md` |
| Roadmap | `references/owners/roadmap.md` |
| Milestone Gate | `references/owners/milestone-gate.md` |
| Effort | `references/owners/effort.md`; also `references/journeys/project-read-model.md` for Work Binding creation or change |
| Asset | `references/owners/asset.md` |
| Authority | `references/owners/authority.md` |
| Explicit Planning Audit | `references/owners/planning-audit.md` |
| Planning Review | `references/owners/planning-review.md` |

Selected references own their operation sequence, readback, failure boundary, and owner-local
follow-up. They do not route onward.

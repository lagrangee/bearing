---
name: bearing
description: Coordinate Bearing planning, repository integration, and provider-native work when explicitly requested or nominated by the active repository's managed Bearing pointer.
---

# Bearing

Coordinate project governance, Repository Configuration, native work, and execution through one
public Agent surface.

## Entry and runtime selection

The Repository Configuration managed pointer is the sole authority for contextual nomination. Use
it only under its stated conditions; repository presence does not nominate Bearing. Explicit
Bearing invocation remains available when the pointer did not nominate the request.

### Composed native work

For a request that creates, reads, or changes native work in a Bearing-nominated repository, compose
**Native admission → authorized owner work → required Native follow-up → Human response**. Preserve
an actually invoked Skill as work owner; otherwise use Ordinary Owner Work. Load
`references/journeys/native-work.md` immediately. For an implementation or executor request, also
load `references/journeys/execution.md` before Native admission or owner work. When Native Inspect
reports `capture-required`, load `references/journeys/project-read-model.md` before running its
baseline capture. Only an invoked owner's required exact claim may precede Native Inspect.
Internal owner completion or successful required synchronization returns
to remaining authorized work in the same request. Preserve its full pending native write set across
those boundaries; use a Human Handoff only for a material choice or authorization.

Select the CLI from the managed pointer. Replace the leading `bearing` token in every command below
with that CLI. Stable Runtime uses `$HOME/.bearing/bin/bearing`. Development Runtime uses
`node <repo-root>/dist/cli.js`; first run its `runtime inspect --repo <repo-root>` operation and
require one coherent Development receipt. Development never falls back to Stable CLI, Skill, or
state. Each functional operation validates its required Repository Integration Lifecycle before
cache creation, provider I/O, or mutation.

All runtime reference paths below are relative to this `SKILL.md`. Load only the direct references
selected for the current operation.

Treat an applied Global Kit Install or Update, or a coherent Development receipt with a
different runtime identity or source provenance, as a new runtime contract. Re-read this
`SKILL.md` completely and every already-selected direct reference before the next functional
operation. A no-op, failed, or rolled-back transition does not change the loaded contract.

## Universal invariants

- The Agent owns semantic meaning, judgment, acceptance interpretation, canonical content, and
  scoped repair of its own attempted write set. Deterministic Bearing Modules own contained reads,
  schema and reference validation, exact reconciliation, projection, and typed diagnostics. Treat
  each published Project Read Model generation as the current machine-owned result until a later
  Bearing operation replaces or rebuilds it.
- Work Management owns native status, claim, blockers, dependencies, checklists, Answer, and
  resolution. Execution owns implementation, tests, review, commit, and its result. Portal is
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
| Global Kit Update check | `bearing update` |
| Sealed Repository Configuration candidate | `bearing configure plan <accepted-arguments>` |
| Accepted sealed Repository Configuration change | `bearing configure apply <accepted-arguments> --plan-token <token>` |
| Project Context | `bearing inspect project --repo <repo-root>` |
| One planning target | `bearing inspect <stable-planning-reference> --repo <repo-root>` |
| One native subject and Binding lookup | `bearing inspect --native <native-reference> --repo <repo-root>` |
| Current deterministic diagnostics | `bearing inspect diagnostics --repo <repo-root>` |
| Targeted reconciliation and current Project Read Model publication | `bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope> --ref <native-reference> [--ref <native-reference>]` |
| Exact Work Binding provider baseline | `bearing provider capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] --repo <repo-root>` |
| Explicit all-Binding provider verification | `bearing provider verify --all --repo <repo-root>` |
| Disposable Project Read Model rebuild | `bearing cache rebuild --repo <repo-root>` |
| Project Catalog operation | `bearing catalog <catalog-operation> <accepted-arguments>` |
| Foreground Portal Host | `bearing portal [--port <1-65535>]` |

Commands return typed outcomes. `complete` proves only the coverage declared by that operation; it
does not prove readiness, acceptance, lifecycle transition, or mutation authority.

Global Kit Update is a user-level transaction independent from Repository Update. Explicit
`bearing update` authorizes one foreground npm `latest` update check only. A newer verified exact
candidate requires separate Human confirmation before mutation; decline, cancellation, older or
unverifiable evidence, and `Current Kit Unverifiable` are no-write results. Update preserves only
existing package-owned Agent Surface links and does not select a newly detected surface, configure
a repository, run Agent-guided Repository Update, or start Portal. Exact-version selection stays
with the package entry that invokes that exact candidate's installer.

## Direct reference routing

For first Bearing planning in a configured project with empty canonical state, load the canonical
mutation contract and the Summary, Roadmap, Gate, and Effort owners below before preparing the
candidate. Include a Summary of the project's accepted purpose, current design, and boundaries.
Add the smallest Roadmap, Gate, and planned Effort set needed by the requested horizon, decision
boundary, and delivery commitment, including its index and orders. Present this complete set for
acceptance before writing; missing project meaning requires clarification. Provider-native PRDs,
Maps, and Tickets remain separate work and do not substitute for this canonical candidate. First
authoring alone grants no native scope creation, Binding, or Activation authority.

| Operation | Load directly |
| --- | --- |
| Canonical planning candidate or accepted semantic mutation | `references/contracts/canonical-mutation.md` plus each affected semantic owner below, before preparing the candidate |
| Repository Configuration | `references/journeys/configure.md` plus exactly one of `references/journeys/configure-fresh.md`, `references/journeys/configure-active.md`, `references/journeys/configure-reactivate.md`, `references/journeys/configure-deactivate.md`, or `references/journeys/configure-unsupported.md` |
| Repository Update | `references/journeys/update.md` and `references/journeys/project-read-model.md` |
| Project Catalog | `references/journeys/catalog.md` |
| Project Read Model rebuild, provider capture, or provider verification | `references/journeys/project-read-model.md` |
| Project Orientation | `references/journeys/project-orientation.md`; when existing-work evidence is included, also `references/journeys/scope-review.md` and `references/journeys/native-work.md`; before any provider capture, add `references/journeys/project-read-model.md` |
| Whole-project Scope Review | `references/journeys/scope-review.md` and `references/journeys/native-work.md`; before any provider capture, add `references/journeys/project-read-model.md` |
| Feature Intake for a proposed feature related to accepted planning or work | First load `references/journeys/feature-intake.md`; before preparing a canonical candidate, add `references/contracts/canonical-mutation.md` and each affected owner; after acceptance, add `references/journeys/native-work.md` when the selected continuation writes native work; a named planned Effort start also uses `references/owners/effort.md` and `references/journeys/project-read-model.md` |
| Native work, including through another Skill | `references/journeys/native-work.md`; also `references/journeys/project-read-model.md` when Native Inspect reports `capture-required` |
| Start or enroll an Effort through Matt work | `references/contracts/canonical-mutation.md`, `references/owners/effort.md`, `references/journeys/native-work.md`, and `references/journeys/project-read-model.md` |
| Direct Execution | `references/journeys/execution.md` and `references/journeys/native-work.md`; for delivery that starts a named planned Effort with no Binding, also load `references/contracts/canonical-mutation.md`, `references/owners/effort.md`, and `references/journeys/project-read-model.md` before preparing its start; otherwise add `references/journeys/project-read-model.md` only when Native Inspect reports `capture-required` |
| Explicit Next Work guidance | `references/journeys/next-work.md` |
| Project Summary | `references/owners/project-summary.md` |
| Project Brief | `references/owners/project-brief.md` |
| Roadmap | `references/owners/roadmap.md` |
| Milestone Gate | `references/owners/milestone-gate.md` |
| Effort | `references/owners/effort.md`; also `references/journeys/project-read-model.md` for Work Binding creation or change |
| Effort conclusion | `references/contracts/canonical-mutation.md`, `references/owners/effort.md`, `references/owners/asset.md`, and `references/owners/authority.md` before the candidate; select `references/owners/project-brief.md` for the required evaluation after accepted conclusion, and Project Summary only when its own trigger applies |
| Asset | `references/owners/asset.md` |
| Authority | `references/owners/authority.md` |
| Explicit Planning Audit | `references/owners/planning-audit.md` |
| Planning Review | `references/owners/planning-review.md` |

Selected references own their operation sequence, effect verification, failure boundary, and owner-local
follow-up. They do not route onward.

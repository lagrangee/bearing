---
name: bearing
description: Use for explicit Bearing invocation or when the current repository's Repository Configuration managed pointer nominates this skill.
---

# Bearing

Coordinate project governance, Repository Configuration, native work, and execution through one
public Agent surface. The Repository Configuration managed pointer is the single source of truth
for contextual nomination. Trust that pointer to decide whether it nominated the current request;
do not reconstruct or broaden its conditions here. Explicit Bearing invocation remains the other
authorized entry origin and the fallback when contextual nomination did not occur.

## Execution spine

1. **Establish the request boundary.** Identify the repository, the user request, and whether entry
   is explicit or came from the current repository's managed pointer. A managed-pointer entry is
   valid only for the nomination conditions above. Do not invent nomination from repository
   presence. Completion: one authorized entry origin and one repository are explicit.
2. **Select the first functional operation.** Repository Configuration begins with
   `$HOME/.bearing/bin/bearing configure inspect --repo <repo-root>`. Active governance normally
   begins with `$HOME/.bearing/bin/bearing inspect project --repo <repo-root>`. Catalog, native
   work, execution, reconciliation, and maintenance use their direct product seams. Each functional
   Module independently validates its required Repository Integration Lifecycle before cache
   creation, provider I/O, or mutation. A stale pointer fails closed at the requested operation;
   there is no separate entry preflight. Completion: the first operation has one owner and one
   lifecycle-validating product seam.
3. **Acquire only decision-relevant context.** Use Project Context and direct deeper-read
   references. Read repository sources progressively. Provider acquisition is an explicit cost;
   ordinary inspection performs no hidden provider traversal. A reliable direct continuation may
   reuse visible orientation, but mutable facts and write preconditions are always re-read.
   Completion: every material claim has current evidence and every limitation is visible.
4. **Load the exact one-hop references.** Load only the journeys and owners required by the visible
   operation. A canonical semantic change loads the canonical-mutation contract, one initiating
   owner, and every additional owner whose domain the accepted write set will actually change.
   Inspected objects do not require their owners. Completion: each read, decision, and effect has
   one named authority.
5. **Compose in visible context.** Treat the accepted outcome and authority boundary as the unit of
   authorization, not each deterministic command, tool call, or internal stage. Within that
   boundary, use current evidence to choose the necessary and proportionate follow-up operations,
   even when the next operation uses another product seam. Judge authority, scope, cost, risk,
   reversibility, collateral effects, and ambiguity; continue without repeat confirmation unless
   the evidence creates a materially new boundary that needs a user decision. Complete and
   validate each owner boundary in dependency-safe order. Sequential composition has no persisted
   session mode, operation object, transition dispatcher, or global follow-up engine. There is no
   hidden loop or fallback. Completion: the current stage is complete or has one exact resumption
   point.
6. **Return the original outcome.** Preserve native, executor, provider, and deterministic outcomes
   without translation. State what changed, what did not change, and which acceptance or authority
   is still required. User-visible interaction and new human-reviewed planning content use the
   current user's language; agent-facing contracts remain English. Completion: the original
   request progressed or stopped at a concrete boundary.

## Authority boundaries

- The Agent owns semantic meaning, rationale, materiality, acceptance interpretation, canonical
  content, recommendations, domain-local follow-up judgment, direct canonical edits, and scoped
  repair of its own attempted write set.
- Deterministic Bearing Modules own contained reads, identity, schema and reference validation,
  lifecycle and revision facts, provider acquisition, exact reconciliation, SQLite publication,
  and typed diagnostics. They fail closed and return their typed outcomes. They do not expand scope,
  choose semantic recovery, or translate failure into success.
- Repository Configuration alone owns deterministic Inspect, sealed Plan, and Apply because it
  changes machine-owned configuration and managed pointers.
- Work Management owns native status, claim, blockers, dependencies, checklists, Answer, and
  resolution. Execution owns implementation, tests, review, commit, and its own outcome.
- Portal is read-oriented. It does not authorize canonical or native mutation.
- Direct user acceptance of a complete visible candidate is sufficient. Ask again only for
  ambiguity, a new material conflict, or an unentailed collateral effect.

## Completeness-sensitive reads

Use the installed package-owned CLI:

- Project Context: `$HOME/.bearing/bin/bearing inspect project --repo <repo-root>`
- One planning target: `$HOME/.bearing/bin/bearing inspect <stable-planning-reference> --repo <repo-root>`
- One native reference and local Binding fact: `$HOME/.bearing/bin/bearing inspect --native <native-reference> --repo <repo-root>`
- Diagnostics: `$HOME/.bearing/bin/bearing inspect diagnostics --repo <repo-root>`

`complete` proves coverage only. It never proves readiness, lifecycle, Passage, acceptance, or
mutation authority. Preserve `partial`, `unfulfilled`, `recovery-required`, and `need-update` as
typed limits. Use no title match, repository scan, manual graph join, provider fallback, Portal
startup, or alternate runtime to manufacture completeness.

## Reference map

All runtime references are selected here. No reference routes onward to another owner or journey.

### Shared contract

- For any accepted canonical semantic mutation, load
  `$HOME/.bearing/kit/current/skills/bearing/references/contracts/canonical-mutation.md`.

### Journeys

- For every Repository Configuration intent, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/configure.md`, plus exactly one
  lifecycle variant below.
- For Fresh Configuration, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/configure-fresh.md`.
- For Active modification, executor addition or removal, or ordinary repair, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/configure-active.md`.
- For Deactivated reactivation, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/configure-reactivate.md`.
- For repository deactivation, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/configure-deactivate.md`.
- For Invalid or Unsupported state, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/configure-unsupported.md`.
- For Project Catalog inspect, rename, unregister, relink, or reset, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/catalog.md`.
- For an explicit Active-project Project Orientation or an accepted Fresh offer, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/project-orientation.md`. For a
  complete Orientation that includes existing-work evidence, co-load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/scope-review.md`. Omit Scope Review
  when the user explicitly excludes existing-work evidence.
- For an explicit whole-project Scope Review outside Orientation, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/scope-review.md`.
- For native Work Management or a known native write, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/native-work.md`.
- For direct executor invocation, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/execution.md` and continue the
  original executor command in the same visible operation.
- For explicit Next Work guidance, load
  `$HOME/.bearing/kit/current/skills/bearing/references/journeys/next-work.md`.

### Semantic owners

- For Project Summary creation or material revision, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/project-summary.md`.
- For Project Brief creation or material refresh, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/project-brief.md`.
- For Roadmap horizon creation, revision, order, completion, or supersession, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/roadmap.md`.
- For Milestone Gate definition, revision, order, lifecycle, or Passage, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/milestone-gate.md`.
- For Effort creation, lifecycle, scope, or Work Binding, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/effort.md`.
- For Asset admission, creation, metadata, ownership, source repair, or lifecycle, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/asset.md`.
- For Authority Scope, current Baseline Assets, or baseline explanation, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/authority.md`.
- For an explicit Planning Audit, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/planning-audit.md`.
- For a pending or accepted project-wide or exact-target decision, load
  `$HOME/.bearing/kit/current/skills/bearing/references/owners/planning-review.md`.

### Observable tool effects

- Fresh Configuration uses `bearing configure inspect`, `bearing configure plan`, and
  `bearing configure apply` through the Configure journey.
- A bound native write starts with `bearing inspect --native` and, after successful exact native
  effects, ends with `bearing reconcile-native` for only those subjects and relations.
- A semantic mutation uses `bearing inspect project` or
  `bearing inspect <stable-planning-reference>` before candidate authorship and inspects affected
  targets after publication.

## Truthful outcomes

Report each owner and journey stage separately. Preserve failure, partial, unfulfilled, cancelled,
and unavailable outcomes without translation into success. An already committed owner stage may
remain valid when a later independent stage fails; name the retained effect and resumption point.
Tests, receipts, diagnostics, resolved native work, provider completion, and candidate evidence
never conclude an Effort, pass a Gate, or complete a Roadmap. An empty managed frontier is not a
global claim that no work exists.

## Completion criterion

The entry origin is authorized, every loaded reference came directly from this map, current facts
and mutation preconditions were inspected at the required product seam, each semantic or native
effect stayed with its owner, exact successful native writes were reconciled without scope
expansion, and the user received a truthful outcome or one exact decision/resumption boundary.

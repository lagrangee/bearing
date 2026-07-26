# Bearing Setup

Own repository integration lifecycle and orchestrate explicit Project Catalog maintenance. This internal branch continues from established public orientation and never re-enters the public router; preserve the current request and resume it after successful initialization.

## Process

1. **Inspect.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`, package metadata, current Catalog state, `.bearing/manifest.json` when present, supported root Agent Surface files, selected-surface Work-management Pointers, `.bearing/state/`, `.bearing/cache/`, `.bearing/executor-profiles/`, and every `.scratch/*/effort.md`. A v1 selected-surface pointer is exactly one standalone `Work-management contract: \`<repository-relative-locator>\`` declaration; ordinary mentions, examples, zero declarations, multiple declarations, and selected-surface disagreement are not pointers. Classify the Repository Integration Lifecycle from facts. Do not discover executors or infer provider compatibility from an installed skill. Completion: lifecycle, current surface, provider prerequisite, Catalog health, user-owned files, and every candidate target are inventoried.
2. **Select the branch.** Choose initialize, reconcile, deactivate, purge, Catalog rename, forget, relink, backup repair, global abandoned-lock repair, exact entry-lock repair, or confirmed reset from the request. Package uninstall belongs to the package manager. Catalog maintenance never substitutes for repository lifecycle, and backup repair never substitutes for lock repair. Completion: one branch and its preservation boundary are explicit.
3. **Resolve decisions conversationally.** Report detected facts first, then ask one material decision at a time in the current user's language. The running Agent Surface is the primary fact. Resolve selected surfaces, the one compatible Matt provider prerequisite, and only user-nominated executor candidates. Never present Generic as a choice, scan installed skills, or batch unrelated decisions. Completion: every required choice is explicit and no inspectable fact became a question.
4. **Propose the exact write set.** Initialize or reconcile establishes state and cache, writes the manifest and Provider Configuration plus any explicitly accepted project-owned profiles, and adds concise managed pointers. Reconcile removes only deselected managed blocks. Deactivate removes the manifest and managed pointers and may remove cache while preserving state, provider configuration, profiles, and durable artifacts. Purge inventories every destructive target and preserves durable project artifacts. Catalog rename changes only one alias; forget changes only registration; relink changes one locator and never moves files; backup repair restores the valid backup. Abandoned-lock repair targets the canonical generation plus only its strictly named recovery-claim, staged-owner, initializing, and quarantine artifacts. Exact entry-lock repair derives the canonical lowercase reversible Entry ID encoding and may target only that lock prefix under `$HOME/.bearing/entry-leases/`. Reset replaces an unusable current and backup with an empty Catalog. Completion: semantic effect, preserved data, and exact repository and user-level targets are visible.
5. **Obtain acceptance.** After all decisions are known, present one final owner-separated Apply review covering external prerequisites already completed, the exact repository Apply Unit, preserved user and Matt content, and the later independent Catalog effect. Require one explicit Apply acceptance. Relinking while the old repository remains available requires an earlier move-versus-copy decision. Lock repair requires confirmation that the inspected lock is abandoned; never infer abandonment from malformed or unsafe owner bytes. Reset requires confirmation that every registration will be discarded and re-registration will be manual. Completion: the accepted scope is unambiguous and no second Apply confirmation remains.
6. **Apply and validate.** Re-read the complete set. Use the Planning Transaction for repository lifecycle and shared Catalog primitives for user-level operational state. Fresh initialization with no nominations uses `bearing setup --repo <repo-root> --surface <surface> --provider-contract <repository-relative-locator>`; repeat `--surface` only for explicitly selected surfaces. An accepted deactivation uses `bearing deactivate --repo <repo-root>`; an accepted exact purge uses `bearing purge --repo <repo-root> --confirm-purge`. Repository validation commits before the independent Catalog operation; a Catalog failure yields a truthful pending-repair outcome and never rolls back or relabels the valid repository Apply. Use Catalog maintenance commands only for their matching accepted branch. Never edit Catalog files directly or discover repositories by scanning. Completion: repository and Catalog outcomes are explicit and every successful target validates.
7. **Resume.** When composed from an uninitialized request, return the branch outcome to the existing public orchestration with the original request unchanged. Completion: setup is not mistaken for completion of project work.

## Fresh Setup Journey

Report detected facts before asking anything. Ask one material decision at a time and only when it cannot be resolved from current evidence. A matching instruction file for the running Agent Surface requires no redundant question. When neither instruction file exists, ask whether to create `AGENTS.md`, `CLAUDE.md`, or both. Preserve every unselected surface byte-identical.

A missing Matt prerequisite routes to its owning capability. If the user accepts, let that owner finish, revalidate the result, and resume Setup in the same visible continuation. Refusal produces no Bearing repository writes. A compatible selection records exactly one `matt-skills/v1` Provider Configuration containing its resolved contract locator. Bearing never stores or asks for a tracker driver, rewrites the Matt contract, or falls back from an unsupported contract. It may report discovered native scopes but never binds them or creates an Effort.

The optional executor question accepts zero or more familiar skill names or commands, and zero nominations is a complete Fresh configuration. Never scan, rank, recommend, install, whitelist-match, prefer, or select a default executor. Resolve only the exact nominated skill on the user-selected Agent Surface. Read its `SKILL.md` and directly required local execution-contract references, then make an explicit semantic assessment of whether that owned contract covers end-to-end execution and the final outcome or writeback. Do not infer eligibility from keywords or ask the deterministic CLI to interpret free prose. The structured assessment must list the exact directly required local reference locators, contain the explicit eligibility conclusion, quote exact source excerpts for execution ownership and final writeback, and provide one evidence excerpt for every proposed native artifact and writeback behavior; pass it with the matching `--executor-assessment`. Explain that planning, testing, TDD, debugging, and review helpers remain supporting skills. An unavailable, malformed, ambiguous, or insufficient nomination may be retried or skipped and never blocks Fresh completion.

Each accepted assessment creates one surface-scoped project-owned Execution Profile with a stable key, familiar display name, portable surface-qualified capability locator, source-supported native-artifact rule and writeback behavior, durable-evidence rule, fallback-receipt behavior, and executor-profile provenance. Show the familiar name and concise writeback summary for explicit confirmation before Apply. Multiple registrations coexist without cross-surface deduplication, priority, preference, or default semantics. Registration installs or changes no skill. The package-owned Generic fallback remains hidden during Setup, creates no repository profile, and is disclosed only when an actual later writeback matches no specialized registration.

After decisions are complete, show one final owner-separated Apply review. The repository Apply Unit contains the active manifest, Provider Configuration, any explicitly accepted profiles, and managed blocks on selected surfaces. Re-read and validate the complete virtual result before writing it atomically. Catalog registration follows repository validation as an independent outcome.

An applied Fresh outcome states the selected surfaces, verified Matt contract, configured nominations or none, repository validation, and Catalog result. It explicitly states that Setup created no Roadmap, Milestone Gate, Effort, Work Binding, or Matt-owned mutation. A Portal project link or foreground start hint is optional and never changes Setup success. Offer Initial Bearing Analysis separately only after complete Fresh success; it is non-mutating and transient unless the user later chooses to preserve an output.

## Read Set

- Established public orientation, including repository identity, manifest state, and the original request; do not re-enter the router
- Package metadata and only the exact user-nominated skill contracts
- Root `AGENTS.md` and/or `CLAUDE.md`
- `docs/agents/issue-tracker.md` and the configured Work Management adapter contract
- `.bearing/manifest.json`, state, cache, and executor profiles
- `.scratch/*/effort.md`
- Current and backup Project Catalog documents for document mutation or lifecycle writeback
- Exact global or entry lock directory and owner entry metadata for abandoned-lock repair; read owner bytes only through the bounded single-link regular-file reader
- Exact targets involved in the selected branch

## Write Set

- Initialize/reconcile: `.bearing/state/`, `.bearing/cache/`, `.bearing/manifest.json`, `.bearing/provider.json`, explicitly accepted `.bearing/executor-profiles/*.md`, and managed root pointers
- Post-validation Catalog stage: idempotent Catalog upsert with an independent outcome
- Deactivate: managed pointers, manifest, optionally cache, then removal of the matching Catalog entry
- Purge: only the explicitly accepted Bearing-owned delete set, then removal of the matching Catalog entry
- Catalog document operations: `$HOME/.bearing/catalog.json`, its last-known-good backup, and transient lock or atomic-write targets through shared CLI primitives only
- Global abandoned-lock repair: the identity-revalidated canonical generation and only its strictly named owner, recovery claim, staged-owner, initializing, and quarantine artifacts
- Entry abandoned-lock repair: the identity-revalidated canonical encoded lock prefix and only its strictly named owner, recovery claim, staged-owner, initializing, and quarantine artifacts; never another entry prefix

Never stage, commit, or edit `.gitignore`. Never delete mocks, prototypes, source, native evidence, or other durable project artifacts merely because Bearing is deactivated, purged, forgotten, or relinked.

## Outcomes

- `applied`: the complete accepted operation validates.
- `no-op`: repository integration or Catalog state already matches.
- `awaiting-decision`: surfaces, profiles, destructive scope, move-versus-copy, reset consequence, or proposed writes await acceptance.
- `partial`: the validated repository Apply is complete while an independent cross-owner stage such as Catalog registration remains pending and repairable.
- `blocked`: adapter support is absent, validation or rollback prevents trustworthy repository state, or Catalog locking or recovery prevents the requested user-level mutation.
- `cancelled`: the user declines a prerequisite, configuration decision, or final Apply; no unaccepted Bearing repository write occurs.

## Recovery

Retain original bytes and remove only transaction-created repository targets when a repository transaction fails before commit. Purge commits when the exact `.bearing` namespace is atomically detached. If recursive cleanup then fails, do not rename a partially deleted quarantine back into place or claim restoration: return `blocked` with the exact typed cleanup-residue path, keep the repository outcome applied, and continue the independent Catalog removal attempt. If a committed repository lifecycle operation is followed by Catalog failure, do not roll back the repository: return `partial` with separate `Repository` and `Catalog` outcomes, then retry reconcile or lifecycle removal idempotently. A degraded Catalog permits only repair from its trustworthy backup; unusable current and backup permit only confirmed empty reset. An indeterminate global lock requires a separately accepted `repair-lock --confirm-abandoned`; an indeterminate entry lock requires `repair-entry-lock --entry <id> --confirm-abandoned`. Refuse a live owner, a nonempty owner directory, or any identity replacement and re-inspect on retry. Report attempted, restored, and currently changed targets. A customized profile conflict is `awaiting-decision` before writes, never an overwrite.

## Completion Criterion

The selected repository lifecycle or Catalog state is explicit, every accepted target matches it, preserved data remains present, no repo-local protocol or skill copy exists, split outcomes are reported truthfully, and any original project request has returned to its governing runbook.

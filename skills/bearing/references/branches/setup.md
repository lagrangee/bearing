# Bearing Setup

Own repository integration lifecycle and orchestrate explicit Project Catalog maintenance. This internal branch continues from established public orientation and never re-enters the public router; preserve the current request and resume it after successful initialization.

## Process

1. **Inspect.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`, package metadata, current Catalog state, `.bearing/manifest.json` when present, supported root Agent Surface files, `docs/agents/issue-tracker.md`, `.bearing/state/`, `.bearing/cache/`, `.bearing/executor-profiles/`, and every `.scratch/*/effort.md`. Detect installed end-to-end executor skills. For MVP initialization, require the Matt-native local Markdown adapter in the issue-tracker contract. Completion: adapter support, enablement, Catalog health, user-owned files, and every candidate target are inventoried.
2. **Select the branch.** Choose initialize, reconcile, deactivate, purge, Catalog rename, forget, relink, backup repair, global abandoned-lock repair, exact entry-lock repair, or confirmed reset from the request. Package uninstall belongs to the package manager. Catalog maintenance never substitutes for repository lifecycle, and backup repair never substitutes for lock repair. Completion: one branch and its preservation boundary are explicit.
3. **Select surfaces and profiles.** For initialize or reconcile, propose supported Agent Surfaces and `generic-agent`; add detected profiles only for capabilities that own execution through final writeback. Inspect user-supplied executor skills before accepting them. A profile describes compatibility and never selects a default executor. Completion: each proposed surface and profile has a reason.
4. **Propose the exact write set.** Initialize or reconcile establishes state and cache, writes the manifest and selected project-owned profiles, and adds concise managed pointers. Reconcile removes only deselected managed blocks. Deactivate removes the manifest and managed pointers and may remove cache while preserving state, profiles, Effort sidecars, and durable artifacts. Purge inventories every destructive target and preserves durable project artifacts. Catalog rename changes only one alias; forget changes only registration; relink changes one locator and never moves files; backup repair restores the valid backup. Abandoned-lock repair targets the canonical generation plus only its strictly named recovery-claim, staged-owner, initializing, and quarantine artifacts. Exact entry-lock repair derives the canonical lowercase reversible Entry ID encoding and may target only that lock prefix under `$HOME/.bearing/entry-leases/`. Reset replaces an unusable current and backup with an empty Catalog. Completion: semantic effect, preserved data, and exact repository and user-level targets are visible.
5. **Obtain acceptance.** Require explicit acceptance for initialization, changed surfaces or profiles, deactivation, the exact purge set, and every Catalog mutation. Relinking while the old repository remains available requires an explicit move-versus-copy decision. Lock repair requires confirmation that the inspected lock is abandoned; never infer abandonment from malformed or unsafe owner bytes. Reset requires confirmation that every registration will be discarded and re-registration will be manual. An ambiguous Bearing reset or repair request returns repository lifecycle, backup recovery, and lock recovery choices without writing. Completion: the accepted scope is unambiguous.
6. **Apply and validate.** Re-read the complete set. Use the Planning Transaction for repository lifecycle and shared Catalog primitives for user-level operational state. Initialize or reconcile uses `bearing setup --repo <repo-root> --surface <surface> --profile <profile>`. An accepted deactivation uses `bearing deactivate --repo <repo-root>`; an accepted exact purge uses `bearing purge --repo <repo-root> --confirm-purge`. Those commands commit the repository lifecycle mutation first and report the matching Catalog removal as a separate outcome; retry only that idempotent removal when needed. Use `bearing catalog rename --entry <id> --name <alias>`, `forget --entry <id>`, `relink --entry <id> --repo <root> [--confirm-move]`, `repair`, `repair-lock --confirm-abandoned`, `repair-entry-lock --entry <id> --confirm-abandoned`, or `reset --confirm-empty` only for its matching accepted branch. Lock repair refuses a valid live or process-indeterminate owner, follows no links, removes no unknown or nonempty target, and performs no recursive deletion. Entry-lock repair may enumerate the fixed lease parent only to match the requested canonical prefix; it never targets or repairs a sibling entry. Never edit Catalog files directly or discover repositories by scanning. Preserve customized profiles unless their exact diff was accepted. Validate repository and Catalog outcomes independently. Completion: both outcomes are explicit and every successful target validates.
7. **Resume.** When composed from an uninitialized request, return the branch outcome to the existing public orchestration with the original request unchanged. Completion: setup is not mistaken for completion of project work.

## Read Set

- Established public orientation, including repository identity, manifest state, and the original request; do not re-enter the router
- Package metadata, templates, and installed skill catalog
- Root `AGENTS.md` and/or `CLAUDE.md`
- `docs/agents/issue-tracker.md` and the configured Work Management adapter contract
- `.bearing/manifest.json`, state, cache, and executor profiles
- `.scratch/*/effort.md`
- Current and backup Project Catalog documents for document mutation or lifecycle writeback
- Exact global or entry lock directory and owner entry metadata for abandoned-lock repair; read owner bytes only through the bounded single-link regular-file reader
- Exact targets involved in the selected branch

## Write Set

- Initialize/reconcile: `.bearing/state/`, `.bearing/cache/`, `.bearing/manifest.json`, selected `.bearing/executor-profiles/*.md`, managed root pointers, and the idempotent Catalog upsert
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
- `blocked`: adapter support is absent, validation or rollback prevents trustworthy repository state, or Catalog locking or recovery prevents the requested user-level mutation.

## Recovery

Retain original bytes and remove only transaction-created repository targets when a repository transaction fails before commit. Purge commits when the exact `.bearing` namespace is atomically detached. If recursive cleanup then fails, do not rename a partially deleted quarantine back into place or claim restoration: return `blocked` with the exact typed cleanup-residue path, keep the repository outcome applied, and continue the independent Catalog removal attempt. If a committed repository lifecycle operation is followed by Catalog failure, do not roll back the repository: return `blocked` with separate `Repository` and `Catalog` outcomes, then retry reconcile or lifecycle removal idempotently. A degraded Catalog permits only repair from its trustworthy backup; unusable current and backup permit only confirmed empty reset. An indeterminate global lock requires a separately accepted `repair-lock --confirm-abandoned`; an indeterminate entry lock requires `repair-entry-lock --entry <id> --confirm-abandoned`. Refuse a live owner, a nonempty owner directory, or any identity replacement and re-inspect on retry. Report attempted, restored, and currently changed targets. A customized profile conflict is `awaiting-decision` before writes, never an overwrite.

## Completion Criterion

The selected repository lifecycle or Catalog state is explicit, every accepted target matches it, preserved data remains present, no repo-local protocol or skill copy exists, split outcomes are reported truthfully, and any original project request has returned to its governing runbook.

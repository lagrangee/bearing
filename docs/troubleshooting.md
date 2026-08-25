# Troubleshooting

[简体中文](troubleshooting.zh-CN.md)

When something goes wrong, preserve source truth first.

## Installation target conflict

Run the intended exact package candidate's `bearing install` command. Bearing refuses conflicting
files and symbolic links rather than silently overwriting them.

## Interrupted update or corrupted bundle

Run the same verified exact candidate's `bearing install` entrypoint again. Bearing stages and
validates the complete CLI and single-skill bundle before switching it. A failed
switch restores the previous complete bundle; it does not touch repository state. Do not repair one
CLI or skill file independently, because that would split the version-compatible bundle.

If the installed `kit/current/package.json` is missing, malformed, or unsafe, install returns
`Current Kit Unverifiable`, reports that exact target, and changes no bytes. If the Human accepts
recovery, run `bearing uninstall`, then perform a verified Fresh Install from the intended exact
candidate. Do not overwrite or classify the untrustworthy current target as a repair input.

## Missing skill

Confirm that the intended complete Skill Directory already exists at `~/.agents/skills`,
`~/.claude/skills`, or `~/.workbuddy/skills`, then run `bearing install` again and select it in the
keyboard checklist. Non-interactive callers may pass the corresponding resolved `--surface` value.
Bearing does not create missing surface directories. User-created copies are unsupported unmanaged
integrations and receive no install or refresh fallback.

## Bare command is not discoverable

The canonical absolute locator remains `$HOME/.bearing/bin/bearing`. To expose bare `bearing` in
the current session, run:

```bash
export PATH="$HOME/.bearing/bin:$PATH"
```

For future terminals, add the same line to the appropriate shell startup profile. Bearing does not
write, append, or source profiles.

## Missing work-management adapter

Bearing requires the supported Matt-native local Markdown Map and Ticket workflow for the first Preview. Create or restore that work scope before inspecting current work.

## Project diagnostics

Run:

```bash
bearing inspect diagnostics --repo .
```

Read the typed diagnostic rows printed by the command. The Project Read Model is disposable; malformed source files need owner-specific correction.

## Portal does not open

Run:

```bash
bearing portal
```

Use the loopback URL printed by the command. If the port is busy, set another port through CLI help or the supported environment variable.

## Unsupported schema

Bearing fails closed and reports the unsupported repository. Install a Bearing version whose
documented readable range includes that schema. An older runtime never downgrades, rewrites, or
deletes newer state. If a release-specific state upgrade already occurred, rollback requires that
release's verified backup; package downgrade alone is not state rollback.

An exact package candidate older than the trusted current Kit is always blocked without writes.
There is no override or compatibility scan in the basic installer.

## Deactivate, remove repository state, and uninstall

These are different operations:

- Repository Configuration deactivation changes one repository;
- external platform removal removes repository-owned Bearing state after explicit review;
- package uninstall removes only the package-manager-owned installation.

Repository deactivation uses the sealed Repository Configuration path:

```bash
bearing configure plan --intent deactivate --repo .
bearing configure apply --intent deactivate --repo . --plan-token <sealedPlanToken>
```

Deactivation preserves canonical state, Provider Configuration, profiles, artifacts, and native
work. It removes managed pointers and disposable cache. Catalog unregister runs afterward and
reports a failure separately. An unsafe `.bearing` namespace or manifest fails closed before any
write.

Bearing has no generic built-in repository migration, compatibility fallback, Purge, cutover,
recovery export, or quarantine path. A listed supported older Preview source can return
`repository-update-required`; follow the package-owned guide, show the complete semantic effect,
and wait for Human confirmation. Validate canonical state, apply only the guide's accepted write
scope, then rebuild the disposable Project Read Model. Do not edit SQLite rows. A newer repository
returns `kit-update-required` and keeps repository bytes unchanged. Unknown or corrupt state
remains Unsupported and unchanged. If the Human separately chooses
repository removal, inspect exact paths and obtain explicit authorization. Do not use
`catalog unregister` as a substitute for repository removal.

Explicit `bearing uninstall` removes only the Global Kit bundle, CLI shim, and Bearing-managed Agent
Surface pointers. It preserves the Project Catalog and repository state. Repository Deactivation
and repository-state removal are separate Agent-owned lifecycle operations.

Package uninstall remains owned by the package manager, for example
`npm uninstall -g @lagrangee/bearing` for a global npm installation. It does not remove the Project
Catalog or repository state. Never substitute `bearing catalog unregister` for repository lifecycle:
unregister changes registration only.

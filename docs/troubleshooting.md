# Troubleshooting

[简体中文](troubleshooting.zh-CN.md)

When something goes wrong, preserve source truth first.

## Installation target conflict

Run the Global Kit wizard, select Install, Update, or Repair, and read the target preview. Bearing
refuses conflicting files and symbolic links rather than silently overwriting them.

## Interrupted update or corrupted bundle

Run the same explicit `npx @lagrangee/bearing` lifecycle entrypoint again. Bearing stages and
validates the complete CLI and single-skill bundle before switching it. A failed
switch restores the previous complete bundle; it does not touch repository state. Do not repair one
CLI or skill file independently, because that would split the version-compatible bundle.

If the installed `kit/current/package.json` is missing or malformed, rerun the exact intended
candidate. Bearing treats untrusted installed metadata as repair input, stages the candidate first,
and replaces the complete bundle. A valid installed manifest is still authoritative for downgrade
ordering and confirmation, and repository schema compatibility always remains fail closed.

## Missing skill

Run the installer again for the intended Agent Surface. If you use multiple surfaces, install both explicitly through the wizard or advanced command path.

## Missing work-management adapter

Bearing requires the supported Matt-native local Markdown Map and Ticket workflow for the first Preview. Create or restore that work scope before expecting alignment against active work.

## Sync diagnostics

Run:

```bash
bearing sync --repo .
```

Read the report path printed by the command. Cache diagnostics are disposable; malformed source files need owner-specific correction.

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

## Explicit downgrade

Use an exact package version and confirmation only after reviewing that release's compatibility and
rollback notes:

```bash
npx @lagrangee/bearing@<version> install --surface agent-skills --confirm-downgrade
```

The command scans every Catalog repository and switches the complete bundle only when all repository
schemas are readable. SemVer ordering includes prereleases. A confirmed downgrade may move within
one minor or to the immediately preceding minor only; cross-major and multi-minor downgrades are
refused. Automatic state rollback is unsupported.

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

Bearing has no built-in repository Purge, migration, cutover, recovery export, or quarantine path.
If an Unsupported Preview repository is removal-required, inspect exact paths, get explicit user
authorization, use an Agent-reviewed external platform removal, and then run Fresh Repository
Configuration. Do not use `catalog unregister` as a substitute for repository removal.

Wizard Global Uninstall removes only the Global Kit bundle, CLI shim, and Bearing-managed Agent
Surface pointers. It preserves the Project Catalog and repository state. Repository Deactivation
and repository-state removal are separate Agent-owned lifecycle operations.

Package uninstall remains owned by the package manager, for example
`npm uninstall -g @lagrangee/bearing` for a global npm installation. It does not remove the Project
Catalog or repository state. Never substitute `bearing catalog unregister` for repository lifecycle:
unregister changes registration only.

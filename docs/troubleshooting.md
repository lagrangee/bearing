# Troubleshooting

[简体中文](troubleshooting.zh-CN.md)

When something goes wrong, preserve source truth first.

## Installation target conflict

Re-run the install wizard and read the target preview. Bearing refuses conflicting files and symbolic links rather than silently overwriting them.

## Interrupted update or corrupted bundle

Run the same explicit `npx @lagrangee/bearing` lifecycle entrypoint again. Bearing stages and
validates the complete CLI, protocol, templates, and skills bundle before switching it. A failed
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

## Deactivate, purge, and uninstall

These are different operations:

- repository deactivation changes one repository;
- purge removes repository-owned Bearing state;
- package uninstall removes only the package-manager-owned installation.

Repository deactivation and purge have executable, separate paths:

```bash
bearing deactivate --repo .
bearing purge --repo . --confirm-purge
```

`deactivate` preserves repository state and native work. `purge` removes only the exact `.bearing`
namespace and managed root blocks; it preserves `.scratch`, source, docs, and durable native
artifacts. Both remove the matching Catalog registration after the repository mutation and report a
Catalog failure separately.

Both commands reject a `.bearing` symbolic link or unsafe namespace shape. They read or change
`.bearing/manifest.json` only when it is missing or a single-link regular file. A manifest symlink,
directory, multiply-linked file, or special type fails closed, so lifecycle operations never follow
that entry into external state.

Purge commits when `.bearing` is atomically detached. If later recursive cleanup fails, the command
returns blocked with an exact partial quarantine path. The repository remains purged, the Catalog
removal is still attempted, and the quarantine is explicitly not a restorable backup. Inspect and
remove only that reported path; do not rename partially deleted bytes back to `.bearing`.

Package uninstall remains owned by the package manager, for example
`npm uninstall -g @lagrangee/bearing` for a global npm installation. It does not remove the Project
Catalog or repository state. Never substitute `bearing catalog forget` for repository lifecycle:
forgetting changes registration only.

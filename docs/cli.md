# CLI reference

[简体中文](cli.zh-CN.md)

Most users should start with:

```bash
npx @lagrangee/bearing
```

The wizard is the public install path. The explicit commands below are for agents, smoke tests, and advanced recovery.

## Help

```bash
bearing --help
bearing --version
```

## Install user-level kit

```bash
bearing install --surface agent-skills
bearing install --surface agent-skills --surface claude
```

Install, update, and repair stage a complete package-owned bundle before switching
`$HOME/.bearing/kit/current`. Selected Agent Surface links and the canonical CLI resolve through
that one bundle. A failed switch restores the previous complete bundle and never changes repository
state. Rerunning the exact candidate also repairs a missing or malformed installed
`kit/current/package.json`; valid installed metadata still governs downgrade checks.

An explicit downgrade is an advanced recovery action:

```bash
npx @lagrangee/bearing@<version> install --surface agent-skills --confirm-downgrade
```

Downgrade requires the flag and a read-only compatibility scan of every Catalog repository. SemVer
ordering applies to patches and prereleases. Only a same-minor downgrade or one step to the
immediately preceding minor is supported; cross-major and multi-minor skips are refused. Downgrade
is not repository-state rollback. If state was upgraded, restore the release-specific verified
backup first; otherwise the downgrade fails closed.

## Enable one repository

```bash
bearing setup --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md \
  --executor agent-skills:implement \
  --executor-assessment '<Agent-Surface-authored semantic assessment JSON>'
```

`setup` enables the repository without copying global protocol or skills into the repository.
Fresh Setup requires one confirmed repository-relative `matt-skills/v1` Provider Contract locator.
It writes an active manifest, the Provider Configuration, and managed pointers only for selected
Agent Surfaces as one repository Apply Unit; zero executor nominations is a complete success and
does not install the Generic fallback. Catalog registration follows repository validation and is
reported independently.
`--executor` is repeatable and accepts only a portable, surface-qualified locator for a skill the
user already nominated. Each nomination requires one matching `--executor-assessment` containing
the Agent Surface's exact directly required local reference locators, explicit
end-to-end/final-writeback conclusion, exact source excerpts, and source-supported profile content.
The CLI verifies those references and excerpts against only the nominated skill contract; it does
not infer ownership from free-prose keywords. Setup reads no other executor skill. Omit both options
to skip specialized registration.
Repeated Setup returns a byte-preserving no-op when the active configuration matches. Material
drift requires `--confirm-repair`. The Agent Surface revalidates each existing specialized profile
by supplying its current `--executor` and structured `--executor-assessment`; an unchanged
assessment produces no write and does not replay an accepted user decision. If the skill is
missing or materially changed, the user explicitly chooses an assessed update,
`--retain-executor <profile-key>`, or `--remove-executor <profile-key>` with `--confirm-repair`.
A deactivated repository is never re-enabled implicitly; after
reviewing its retained surfaces, Provider Configuration, and profiles, pass
`--confirm-reactivate` to restore the managed pointers and active manifest in one Apply Unit.
It refuses an unsupported newer repository schema and directs you to a compatible Bearing version;
it never rewrites newer state as schema 1.

## Deactivate or purge one repository

```bash
bearing deactivate --repo .
bearing purge --repo . --confirm-purge
```

Use these only through an accepted `bearing-setup` lifecycle decision. `deactivate` changes the
manifest to `status: deactivated` and removes only its registered managed root pointers, disposable
cache, and Catalog registration. It preserves `.bearing/state`, Provider Configuration, profiles,
backups, native `.scratch` work, and durable artifacts as the reactivation baseline. `purge`
removes only the repository `.bearing` namespace and managed root pointers after confirmation; it
preserves `.scratch`, source, docs, and other native artifacts. After either repository mutation
commits, Catalog removal is reported separately and can be retried safely if it fails. Purge first
atomically detaches `.bearing`; if recursive
cleanup then fails, the command returns blocked and prints the exact partial quarantine path. That
residue is not a backup, and Bearing never claims that partially deleted bytes were restored.
Both lifecycle commands reject a linked or otherwise unsafe `.bearing` namespace. Before reading or
changing `.bearing/manifest.json`, they require one supported single-link regular lifecycle
manifest when repository configuration exists; a missing authority with retained configuration,
symlink, directory, multiply-linked file, or special type fails closed.

## Sync

```bash
bearing sync --repo .
```

Sync rebuilds deterministic diagnostics and Project Sitemap projection under cache.

## Inspect

```bash
bearing inspect roadmap <roadmap-id> --repo .
bearing inspect gate <gate-id> --repo .
bearing inspect effort <effort-id> --repo .
```

Inspect returns a planning context closure for the selected object.

## Portal

```bash
bearing portal
```

Portal runs in the foreground and prints a loopback URL. `BEARING_PORT` can override the default port when supported by the installed version.

## Catalog

Use `bearing catalog --help` and current command help for rename, forget, remove, relink, repair, and reset operations. Catalog operations can affect user-level project registration; do not run them blindly.

## Package uninstall boundary

Bearing has no repository-scoped package-uninstall command. Remove an npm-owned package installation
with the package manager that installed it, for example `npm uninstall -g @lagrangee/bearing`.
Package removal does not deactivate or purge repositories and does not delete Project Catalog data.

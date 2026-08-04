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

The managed Agent Surface pointer uses the package-owned read-only activation check before loading
the global skill for an ordinary repository request:

```bash
bearing activation check --origin model-invoked --repo .
```

The versioned JSON disposition is `invoke-bearing` only for an Active manifest. Fresh and
Deactivated return `continue-without-bearing`; Invalid or Unsupported return
`stop-for-explicit-entry`. An explicit Bearing entry uses `--origin explicit` and routes to
ordinary Bearing work, Setup, reactivation, or recovery according to the same lifecycle
inspection. The check reads no Catalog or planning projection and performs no writes.

```bash
bearing setup --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md \
  --executor agent-skills:implement \
  --executor-assessment '<Agent-Surface-authored semantic assessment JSON>'
```

`setup` enables the repository without copying package-owned contracts or skills into it.
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

An inspected 0.1.0 repository requires an explicit incompatible cutover; a package-version change
alone does not trigger it. First inspect the exact plan without writing:

```bash
bearing setup --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md \
  --cutover-at 2026-07-26T12:34:56.000Z --plan
```

After separately accepting the upgrade direction and then the complete plan, repeat the same
selection and timestamp with `--accept-upgrade-direction --confirm-cutover
--cutover-plan-token <confirmationToken>`. The token binds the second consent to the inspected
repository generation; any changed source or write set requires a new plan and consent. Setup creates and
verifies the reported `.bearing/backups/0.1.0-to-0.1.1-<timestamp>/` Recovery Bundle before one
rollback-protected conversion. The bundle retains old State, Effort sidecars, integration sources,
managed blocks, hashes, inventory, and receipt; it excludes cache, Matt-native work, unmanaged
content, and external Asset payloads. Conversion moves Efforts into canonical
`.bearing/state/efforts/`, rebuilds disposable projections, and preserves native work. A repository
failure restores the old integration while retaining the verified bundle; later Catalog failure is
reported as a separate resumable partial outcome.

## Deactivate or purge one repository

```bash
bearing deactivate --repo .
bearing purge --repo . --plan
bearing purge --repo . --confirm-purge --purge-plan-token <confirmationToken> \
  --recovery-export /safe/external/bearing-recovery
# Or explicitly accept unrecoverable removal:
bearing purge --repo . --confirm-purge --purge-plan-token <confirmationToken> \
  --accept-no-recovery-export
```

Use these only through an accepted `bearing-setup` lifecycle decision. `deactivate` changes the
manifest to `status: deactivated` and removes only its registered managed root pointers, disposable
cache, and Catalog registration. It preserves `.bearing/state`, Provider Configuration, profiles,
backups, native `.scratch` work, and durable artifacts as the reactivation baseline. `purge`
first returns a no-write exact inventory of every `.bearing` path (including State, profiles,
Registry and backups), each verifiable managed block, and the matching Catalog entry. Its token
binds confirmation to that generation. Confirmation must either create and verify one recovery
export outside `.bearing`, or explicitly accept that canonical history and local backups are
unrecoverable. It then removes only the reviewed `.bearing` namespace and managed root pointers;
it preserves `.scratch`, source, docs, external Asset payloads, and the global kit. A recognized
older or newer schema, unsafe owned target, ambiguous block, or changed generation fails closed.
Invalid repositories may be purged only when every target remains safely identifiable. After either repository mutation
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

Ordinary Sync rebuilds deterministic diagnostics and Project Sitemap projection under cache while
reusing the latest immutable provider observations selected by explicit Work Bindings. It does not
discover standalone work or expand Bearing Scope.

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

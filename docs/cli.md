# CLI reference

[简体中文](cli.zh-CN.md)

Most users should start with:

```bash
npx @lagrangee/bearing
```

The wizard is the public Global Kit maintenance path. The explicit commands below are for agents,
smoke tests, and advanced recovery.

## Help

```bash
bearing --help
bearing --version
```

## Maintain the user-level Global Kit

Run `bearing` with no arguments in an interactive terminal. Select Install, Update, Repair, or
Global Uninstall. Cancellation writes nothing. Install, Update, and Repair use the same complete
bundle transaction described below.

```bash
bearing install
bearing install --surface agent-skills
bearing install --surface agent-skills --surface claude
```

With no `--surface`, the command installs only the complete bundle and canonical CLI. This is the
non-interactive seam for an Agent that owns its own Skill Directory integration. With one or more
`--surface` values, Bearing also manages the selected known Agent Surface links.

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

## Configure one repository

Repository Configuration is Agent-led. Bare `bearing configure` redirects to the public Bearing
skill. The deterministic CLI provides only machine facts, a sealed plan, and exact apply:

```bash
bearing configure inspect --repo .
bearing configure plan --intent activate --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md --executor-mode skip
bearing configure apply --intent activate --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md --executor-mode skip \
  --plan-token <sealedPlanToken>
```

Inspect performs no writes and makes no preference or product decision. Plan needs every material
choice and returns exact targets, preconditions, preservation effects, and a token for that exact
repository generation. Apply recomputes the plan, rejects stale or mismatched tokens, and modifies
only the reviewed Bearing machine configuration and managed pointers. Fresh Configuration creates
the disposable Project Read Model without provider acquisition or substantive planning objects.
Catalog upsert runs after repository validation and reports failure separately. Portal handoff
reports a compatible URL, an incompatible Host restart instruction, or a foreground start
instruction; it never starts Portal.

Use repeatable `--executor` and matching `--executor-assessment` values only after the user nominates
a capable executor. Use `--executor-mode skip` only after an explicit skip decision. Existing
profiles can be retained or removed with `--retain-executor` and `--remove-executor`. Bearing does
not install an executor or infer one from free prose.

Deactivate through the same sealed lifecycle:

```bash
bearing configure plan --intent deactivate --repo .
bearing configure apply --intent deactivate --repo . --plan-token <sealedPlanToken>
```

Deactivation removes the managed pointer and disposable cache. It preserves canonical state,
Provider Configuration, profiles, artifacts, and native work. Catalog unregister is a later,
independently reported stage. Unsupported Preview state is removal-required. Bearing has no
built-in migration, cutover, silent repair, or repository Purge. Repository removal is an external,
explicitly authorized, Agent-reviewed platform operation followed by Fresh Configuration.

The managed pointer gives contextual nomination guidance. Explicit Bearing requests, reliable
continuations, and materially relevant planning or governance work can nominate Bearing. The
working directory, generic roadmap words, repository-independent conversation, and ordinary code
work do not nominate it. Functional operations validate Active lifecycle before cache creation,
provider I/O, or mutation.

## Project Read Model operations

```bash
bearing cache rebuild --repo .
bearing provider verify --all --repo .
bearing inspect project --repo .
```

Cache rebuild creates only the disposable SQLite Project Read Model. Provider verification is an
explicit cost-bearing operation over current Work Bindings. Inspect returns typed committed rows.
These commands do not discover standalone work or expand Bearing Scope.

## Inspect

```bash
bearing inspect project --repo .
bearing inspect effort:<effort-id> --repo .
bearing inspect --native <native-reference> --repo .
bearing inspect diagnostics --repo .
```

Inspect returns a versioned typed envelope from committed Project Read Model rows. The four forms
read bounded Project Context, one stable planning reference, one exact native reference, or typed
diagnostics.

## Portal

```bash
bearing portal
```

Portal runs in the foreground and prints a loopback URL. `BEARING_PORT` can override the default port when supported by the installed version.

## Catalog

Use `bearing catalog --help` for the complete Catalog CLI: inspect, rename, unregister, relink, and confirmed reset. Unregister accepts exactly one Entry ID or repository-root selector. Relink replaces only the registered locator and never moves repository files. Reset creates an empty SQLite Catalog; run Repository Configuration again to re-register repositories. Catalog operations can affect user-level project registration; do not run them blindly.

## Global Uninstall and package-manager boundary

Wizard Global Uninstall removes `$HOME/.bearing/kit/current`, the canonical CLI shim, and only
Bearing-managed Agent Surface pointers. It does not read or change the Project Catalog,
repository canonical state, Provider Configuration, profiles, artifacts, or native work. It is not
repository Deactivation or repository-state removal, and Bearing has no repository-scoped package
uninstall command.

An npm-owned package installation remains owned by npm. Remove it separately with the package
manager that installed it, for example `npm uninstall -g @lagrangee/bearing`.

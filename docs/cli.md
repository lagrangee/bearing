# CLI reference

[简体中文](cli.zh-CN.md)

Most users should ask an Agent to verify one exact published candidate, then run its installer:

```bash
npx --yes @lagrangee/bearing@<resolved-version> install
```

The package candidate and installed CLI expose the same explicit basic primitives. Bare `bearing`
shows concise help; it does not install, configure a repository, or start Portal.

## Help

```bash
bearing --help
bearing --version
```

## Maintain the user-level Global Kit

```bash
bearing install
bearing install --surface agent-skills
bearing install --surface agent-skills --surface claude --surface workbuddy
bearing update
bearing uninstall
```

In an interactive terminal with no `--surface`, Bearing detects only complete, already-existing
`~/.agents/skills`, `~/.claude/skills`, and `~/.workbuddy/skills` directories and presents one
up/down, Space, and Enter checklist. Zero selections are valid. A non-interactive caller passes
resolved supported `--surface` values; it does not emulate key input or infer its current surface.
Bearing never creates a missing surface directory, scans arbitrary locations, or accepts an
arbitrary target.

Install stages and validates a complete package-owned bundle before switching
`$HOME/.bearing/kit/current`. Selected Agent Surface links and the canonical CLI resolve through
that one bundle. Each selected surface is then applied independently as a package-owned symbolic
link and reports `applied`, `no-op`, or `conflict`; one conflict does not roll back the Kit or another
surface. Regular files, directories, non-owned links, and user-created copies are preserved as
unsupported unmanaged integrations. A failed Kit switch restores the previous complete bundle and
never changes repository state. An older exact candidate is always blocked without writes or an override. If the current
`kit/current/package.json` is missing, malformed, or unsafe, the result is `Current Kit
Unverifiable`: install does not overwrite it. Recovery requires a separately authorized
`bearing uninstall`, then a verified Fresh Install from the intended exact candidate.

After every successful install, Bearing prints:

```bash
export PATH="$HOME/.bearing/bin:$PATH"
```

Running that export affects only the current session. Add the same line to the appropriate shell
startup profile if future terminals should discover bare `bearing`. The CLI neither writes nor
sources a profile.

### Check for a Global Kit update

`bearing update` performs one foreground npm `latest` update check. It verifies the returned exact
version, npm integrity, and canonical repository identity before comparing it with the trusted
current Kit. The command does not poll in the background. An up-to-date result is a no-op, and an
older or unverifiable candidate is blocked without writes.

A newer verified candidate prints `Update available: <current> → <target>`. The check itself does
not authorize mutation: an interactive terminal asks for one separate confirmation before handing
off to that exact candidate's `bearing install`. Decline, cancellation, registry failure, and
candidate verification failure preserve the complete current Kit byte-for-byte. Update carries
forward only existing package-owned Agent Surface links; it does not show the surface checklist,
connect a newly detected surface, configure a repository, perform Agent-guided Repository Update,
or start Portal. Arbitrary exact-version selection remains a package-manager operation that invokes
the selected exact candidate's installer.

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

Fresh public Repository Configuration writes the complete schema 2 target with
`runtime: stable`. The source repository uses its separate explicit `runtime: development`
target. Runtime is target identity, not a Human-selected migration mode; missing or invalid
Runtime never defaults, falls back, or silently converts between Stable and Development.

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
independently reported stage. A safely readable older repository can return Repository Update
Required with the installed Kit's complete target contract and a Human-confirmed semantic update
guide. Source version remains provenance rather than a migration dispatch key. The Agent preserves
canonical state and writes only the target manifest; the disposable Project Read Model is rebuilt,
not migrated, without provider acquisition. Newer state returns Kit Update Required. Unknown or
corrupt state remains Unsupported and unchanged. Bearing has no generic built-in migration,
compatibility fallback, cutover, silent repair, or repository Purge. Repository removal is a
separate, explicitly authorized, Agent-reviewed platform operation.

The managed pointer gives contextual nomination guidance. Explicit Bearing requests, reliable
direct continuations, and reasonable material planning or governance relevance can nominate
Bearing. The working directory, generic roadmap words, repository-independent conversation, and
ordinary non-governance code or documentation work do not nominate it. Configure Inspect reports
an edited managed block as `drifted`. Functional operations validate Active lifecycle before cache
creation, provider I/O, or mutation.

## Project Read Model operations

```bash
bearing cache rebuild --repo .
bearing provider verify --all --repo .
bearing inspect project --repo .
```

Cache rebuild creates only the disposable SQLite Project Read Model. Provider verification is an
explicit cost-bearing operation over current Work Bindings. Inspect returns typed committed rows.
These commands do not discover standalone work or expand Bearing Scope.

Capture, verification, reconciliation and local Ensure Current derive a candidate from one captured
canonical basis. Healthy local cache rebuild also uses its committed starting basis. Publication compares the committed metadata and bound evidence used by that
operation in one SQLite transaction. A concurrent change returns
`project-read-model-publication-conflict`; acquired evidence is `unpublished`, and the command is
`unfulfilled` with its actual acquisition count. The result does not claim the winner's observation
or generation. Pending native writes remain pending after a conflicted reconciliation. Inspect the
current evidence before choosing another explicit operation; there is no automatic retry or broader
acquisition.

Fully equivalent final states reuse the committed receipt. Same-semantic attempt or display changes
do not publish another generation, and concurrent detail evidence remains separate. A conflict records
a failed attempt only for a requested bound row that still exactly matches its starting state,
retaining its observation; changed or removed rows are untouched. Canonical files are not rechecked
at completion: a later local edit belongs to a later operation.

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

Explicit `bearing uninstall` removes `$HOME/.bearing/kit/current`, the canonical CLI shim, and only
Bearing-managed Agent Surface pointers. It does not read or change the Project Catalog,
repository canonical state, Provider Configuration, profiles, artifacts, or native work. It is not
repository Deactivation or repository-state removal, and Bearing has no repository-scoped package
uninstall command.

An npm-owned package installation remains owned by npm. Remove it separately with the package
manager that installed it, for example `npm uninstall -g @lagrangee/bearing`.

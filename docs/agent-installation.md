# Agent installation

This guidance is for the Agent that the Human asks to install Bearing. Use the capabilities that
your current environment provides. Do not infer product support from this document.

## 1. Verify one published package

Use `https://github.com/lagrangee/bearing` only to confirm the official project and read this
guidance. Do not clone or execute the mutable `main` branch as the normal installation payload.

If the Human specified a version, query that exact version. Otherwise, resolve the current
published package identity:

```bash
npm view @lagrangee/bearing@latest version dist.integrity repository.url --json
```

Verify that the package name is `@lagrangee/bearing`, the repository URL identifies the canonical
repository, and npm supplies package integrity. Record the returned version as
`<resolved-version>`. Use that exact published package version for the remaining steps.

## 2. Install the complete canonical bundle

Run the non-interactive installation seam. If your own complete Skill Directory is one of the
three supported locations below, add its resolved `--surface` value; otherwise install only the
bundle:

```bash
npx --yes @lagrangee/bearing@<resolved-version> install
npx --yes @lagrangee/bearing@<resolved-version> install --surface <agent-skills|claude|workbuddy>
```

The published package installs one complete, version-matched canonical bundle under
`$HOME/.bearing/kit/current` and the canonical CLI under `$HOME/.bearing/bin/bearing`. Verify that
the installed `package.json` has `<resolved-version>` and that
`skills/bearing/SKILL.md` and its referenced files are present.

Successful install prints `export PATH="$HOME/.bearing/bin:$PATH"`. This affects only the current
session unless the Human separately authorizes an exact startup-profile change; the CLI never
writes, appends, or sources a profile. Continue to use the canonical absolute CLI locator when bare
command convenience is not requested.

An older exact candidate is always a no-write result. If install reports `Current Kit
Unverifiable`, do not overwrite the reported target. Explain that recovery is separately authorized
`bearing uninstall`, followed by a verified Fresh Install from the intended exact candidate.

The machine-readable seam accepts only resolved supported surface selections; it does not infer the
current Agent Surface or emulate terminal key input. Installation does not configure any
repository, start Portal, or create Bearing planning objects. Do not treat the current working
directory as setup consent.

## 3. Integrate the Bearing skill

Bearing recognizes only these complete, already-existing Skill Directories:

- Agent Skills: `~/.agents/skills`
- Claude: `~/.claude/skills`
- WorkBuddy: `~/.workbuddy/skills`

Do not create a missing directory structure, scan another location, or pass an arbitrary target.
For each selected supported surface, Bearing manages one package-owned symbolic link from the
directory's `bearing` entry to:

```text
$HOME/.bearing/kit/current/skills/bearing
```

Bearing preserves current owned links, repairs broken or older package-owned links, and reports an
exact conflict for regular files, directories, or non-owned links. It processes surfaces only after
the complete Kit transaction and reports each one independently, so a conflict does not roll back
the Kit or another successful surface. User-created copies are an unsupported unmanaged
integration; Bearing does not install, refresh, or silently fall back to copies.

## 4. Maintain the installed Global Kit

For a normal latest update check, run the canonical installed CLI:

```bash
$HOME/.bearing/bin/bearing update
```

The explicit command authorizes only one foreground npm `latest` update check. It verifies the
exact published version, npm integrity, and canonical repository identity before comparison. A
newer candidate displays `Update available: <current> → <target>` and requires one separate Human
confirmation before the verified exact candidate's installer runs. Decline, cancellation, an
older candidate, or unverifiable registry evidence changes no bytes. `Current Kit Unverifiable`
routes to separately authorized `bearing uninstall` and a verified Fresh Install; do not overwrite
or repair it through update.

Global Kit Update preserves or safely redirects only existing package-owned surface links. It does
not repeat surface selection, connect newly detected surfaces, configure a repository, perform
Agent-guided Repository Update, or start Portal. These are independent authorities. Exact-version
selection remains at the package-manager entry that invokes that exact candidate's installer.

## 5. Hand off repository setup

After installation and Skill Directory integration, inspect without writing:

```bash
git rev-parse --is-inside-work-tree
```

- If the command confirms a Git repository, ask the Human whether to enable Bearing for the current
  project. Only after the Human confirms, explicitly load the installed public Bearing skill and
  enter its normal Repository Configuration journey. Keep its Inspect, decision, sealed Plan, and
  Apply boundaries.
- If the current directory is not a Git repository, tell the Human: "Open the intended Git project
  and use `/bearing setup` there." Do not claim that repository setup is complete.

Installation and repository setup are separate outcomes. A successful installation does not start
Portal, enroll work in Bearing Scope, create a Work Binding, or accept any planning decision.

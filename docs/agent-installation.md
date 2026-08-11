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

Run the bundle-only, non-interactive installation seam:

```bash
npx --yes @lagrangee/bearing@<resolved-version> install
```

The published package installs one complete, version-matched canonical bundle under
`$HOME/.bearing/kit/current` and the canonical CLI under `$HOME/.bearing/bin/bearing`. Verify that
the installed `package.json` has `<resolved-version>` and that
`skills/bearing/SKILL.md` and its referenced files are present.

This command does not select or imitate a known Agent Surface. It does not configure any
repository, does not start Portal, and does not create Bearing planning objects. Do not treat the
current working directory as setup consent.

## 3. Integrate the Bearing skill

Identify your own Skill Directory and its supported integration mechanisms. Prefer a symbolic link
from its `bearing` entry to:

```text
$HOME/.bearing/kit/current/skills/bearing
```

Check the destination before writing. Do not replace user-owned content. If your environment cannot
use a symbolic link, use a hard copy or another mechanism that it supports, explain that choice to
the Human, and own its refresh and cleanup:

- After each Bearing install, update, or repair, replace the complete copy from the current bundle.
- During cleanup, remove only the integration that you created. Package-manager uninstall and
  Bearing Global Uninstall remain separate operations.

A symbolic link follows complete-bundle updates automatically. Recheck that the linked skill opens
after installation or maintenance, and remove the link when the Human asks you to clean up that
integration.

## 4. Hand off repository setup

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

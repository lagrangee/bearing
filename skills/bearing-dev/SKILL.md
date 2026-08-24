---
name: bearing-dev
description: Use only in the Bearing source repository when its managed pointer selects the Development Runtime, or when explicitly invoked there.
---

# Bearing Development Runtime

Read `../bearing/SKILL.md` completely and use that public root for operation and reference selection.
Pin all repository-scoped Bearing commands to `node <repo-root>/dist/cli.js` from this checkout.

First run `node <repo-root>/dist/cli.js runtime inspect --repo <repo-root>`. Continue only when its
receipt proves that the selected CLI, public Skill, and state root share one coherent Development
Runtime identity. Never use or fall back to the public Stable Kit, CLI, Skill, or state.

## Completion criterion

The public root is loaded from the coherent Development Runtime, and every repository-scoped
Bearing command uses the pinned Development CLI.

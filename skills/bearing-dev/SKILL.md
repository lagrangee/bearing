---
name: bearing-dev
description: Use only in the Bearing source repository when its managed pointer selects the Development Runtime, or when explicitly invoked there.
---

# Bearing Development Runtime

1. Read `../bearing/SKILL.md` completely before any Bearing operation and use it as the governing
   workflow. Completion: the public contract and its directly selected references are available
   from this source checkout.
2. Run `node <repo-root>/dist/cli.js runtime inspect --repo <repo-root>` and continue only when it
   returns a coherent Development Runtime receipt. Completion: the selected CLI, Skill identity,
   and state root belong to one Development Runtime identity.
3. Run every repository-scoped Bearing command through `node <repo-root>/dist/cli.js`. Preserve its
   typed outcomes and Development Runtime receipt. Completion: no public Stable Kit CLI, Skill, or
   state participated in the operation.

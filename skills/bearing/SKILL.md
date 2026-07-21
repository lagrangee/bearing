---
name: bearing
description: Use when handling any project request in a Bearing-enabled repository, or when the user asks to initialize, orient, review, plan, align, summarize, or continue Bearing-managed work.
---

# Bearing

Govern the current user request with project-level context while preserving the native contracts of Work Management and Execution capabilities. This runbook has no persisted mode, target, or thread status.

## Process

1. **Detect enablement.** Resolve the repository root and inspect `.bearing/manifest.json`. When absent, compose `/bearing-setup`, preserve the original request, and resume it after accepted initialization. Completion: the repository is enabled or setup has returned a truthful non-success outcome.
2. **Refresh orientation.** Read `$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md`. Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` when the Project Sitemap is missing, malformed, known to have missed a write-through update, or explicitly requested; otherwise use the existing projection. Read the optional Project Summary and the complete Project Sitemap. The Sitemap remains limited to whole-project orientation, target discovery, source routing, and top-level Attention; it is not a completeness dossier. Completion: the high-level picture and projection freshness are explicit.
3. **Acquire a typed inspection closure when completeness matters.** Before any conclusion or action that depends on Roadmap horizon, Gate readiness, Gate passage, Effort scope, the complete contributor set, or a scope-complete planning mutation, resolve exactly one stable ID and automatically invoke `$HOME/.bearing/bin/bearing inspect <roadmap|gate|effort> <stable-id> --repo <repo-root>` with the corresponding target kind. A readiness-centered or passage-centered question uses Gate inspection. Do not ask the user to run the command. Apply the state contract below before retrieving sources or choosing a mutation path. Completion: the required generation-scoped closure and its state are explicit, or retrieval has stopped with a truthful non-success outcome.
4. **Retrieve sources.** Combine the latest prompt, recent conversation, Summary, Sitemap orientation, and any required typed closure to select materially relevant nodes. Read their canonical source locators, followed references, declared Authorities, cited Assets, and relevant Attention. Reread current canonical source truth before semantic judgment; neither a cache nor an inspection result replaces source authority. Completion: every material recommendation can cite current source truth and remains within the closure state boundary.
5. **Choose the capability path.** Continue ordinary unmanaged work when governance adds no material action; compose a Work Management or Execution capability when it owns the requested work; compose the owning `bearing-*` capability when governance state must change. A scope-complete mutation that depends on an inspection closure requires that closure to be `complete`. When it is `partial`, a user-authorized issue-scoped repair named by the returned issues or an unrelated bounded mutation may still route to its owning `bearing-*` capability with the target and limits explicit. This exception must not treat `partial` as `complete`, fill missing context, or authorize a closure-wide conclusion or mutation. Completion: one owner and its boundary are explicit.
6. **Compose without takeover.** Before another capability runs, provide only relevant governance context. Preserve its native contract, lifecycle, and artifacts. Once the actual executor is known, read its `.bearing/executor-profiles/<profile>.md` contract. After execution, leave native status, blocker, dependency, claim, and resolution writes with Work Management and run sync; apply the protocol-owned Artifact Registration Route for factual artifacts, provenance, and required receipts; route only adoption, disposition, citation, binding, or intent candidates to their owning Bearing capability. Completion: native work remains native and every durable consequence follows exactly one owner path.
7. **Return to the request.** Report the requested result, relevant Attention, inspection state when required, and any bounded Bearing outcome. An empty managed scope never becomes a global "nothing to do" conclusion. Completion: the user's original request has progressed or a concrete blocker is named.

## Typed Inspection Contract

Use only the installed package-owned CLI at the absolute expanded path `$HOME/.bearing/bin/bearing`. The target union is closed to `roadmap`, `gate`, and `effort`.

Inspection is mandatory for any completeness-sensitive claim or action about:

- a Roadmap's horizon, canonical Gate order, focused Gate, all contributing Efforts, or scope completeness;
- a Gate's owning Roadmap, Gate readiness, Gate passage, all contributing Efforts, or passage evidence;
- an Effort's scope, owning Roadmap, Target Gate, declared Authorities, optional Map, tracker-native Tickets, relevant Alignment Checks, registered evidence, or Source Reference completeness.

Use the kind of the subject being inspected. If the prompt and orientation do not identify exactly one stable ID, report the ambiguity or ask for a decision; do not guess a target.

- `complete`: the typed closure permits source retrieval followed by semantic judgment. Reread the closure's canonical Source References before deciding. `complete` establishes retrieval coverage, not mutation authority or an automatic readiness or passage decision.
- `partial`: use the returned context and issues only for bounded orientation and explicitly report incomplete coverage. Do not claim that all contributors are known, assert definitive readiness, claim or record Gate passage, or begin a scope-complete planning mutation. A user-authorized issue-scoped repair or unrelated bounded mutation may proceed only through its owning capability and only within an explicit boundary that does not depend on the missing context.
- `invalid` or unknown target: return a truthful `incomplete` or `blocked` outcome. Do not make a completeness-sensitive semantic claim or planning mutation.
- CLI unavailable, nonzero operational failure, malformed output, or a mismatched generation fingerprint: return `blocked` and name the exact failure. Do not translate an operational failure into an empty or complete planning scope.

## No Fallback Boundary

Never use a title match, keyword search, `rg`, prose similarity, or a manual Sitemap join as a compatibility fallback for a missing or non-complete typed closure. Those clues may support whole-project orientation, but they cannot select an ambiguous stable ID or prove scope completeness. Never replace the absolute package-owned CLI with shell `PATH` lookup, Portal startup, a network service, a daemon, or a skills-only runtime fallback. Do not start Portal or ask the user to remember or execute the inspection command.

## Read Set

- `$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md`
- `.bearing/manifest.json`
- `.bearing/state/project-summary.md` when present
- `.bearing/cache/project-sitemap.md`
- A required typed Roadmap, Gate, or Effort inspection closure
- Canonical sources selected from the Sitemap
- `.bearing/executor-profiles/<profile>.md` after an actual executor is selected
- Latest prompt and recent conversation

## Write Set

Never mutate canonical planning state. This runbook may invoke deterministic `bearing sync`, may compose an owning capability whose own contract controls its writes, and may require the host's protocol-owned Artifact Registration Route after execution. The route owns its factual Asset Registry write; `/bearing` does not become its writer.

## Outcomes

- `applied`: the requested path completed and any delegated owned writes validated.
- `no-op`: Bearing context was applied but no managed mutation or refresh was needed.
- `awaiting-decision`: an owning capability needs user acceptance.
- `blocked`: setup, typed inspection, source truth, or the selected capability cannot proceed safely.
- `incomplete`: a typed closure or composed analysis truthfully reports partial, invalid, unknown, or otherwise insufficient coverage.

## Recovery

When the Sitemap conflicts with a source, trust the source and run sync. When the target or topic changes, repeat orientation from the latest prompt; do not reuse a hidden mode. When inspection or a composed capability fails, preserve its outcome and recovery report rather than translating it into success or reconstructing the missing closure.

## Completion Criterion

The current user request has been handled with relevant canonical context, one capability owner is respected, native lifecycle is preserved, and every managed write is either validated and synced or reported with its exact blocker.

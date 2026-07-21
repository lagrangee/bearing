---
name: bearing-next-work
description: Use when the user asks what to do next, needs a project-aware morning work surface, or wants one prioritized direction plus alternatives without claiming or starting work.
---

# Bearing Next Work

Recommend a useful frontier without becoming a scheduler or executor. This capability may be invoked directly or composed by `/bearing` for a current user request.

## Process

1. **Orient.** Read `$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md`. If uninitialized, compose `/bearing-setup` and resume. Read Project Summary, complete Sitemap, trustworthy diagnostics, Attention, Roadmap Horizons, Gate Readiness, Effort frontiers, claimed and ready native work, Fog, Asset signals, and the current Planning Audit when fresh. Completion: each candidate direction has current source evidence.
2. **Bound empty state.** If no managed frontier exists, return `no-op` with reason `no-managed-frontier`, write no advisory snapshot, and continue the user's original request using ordinary repository and conversation context. Never turn missing Bearing work into "nothing to do." Completion: absence is scoped to Bearing evidence.
3. **Rank directions.** Choose one concrete Primary Recommendation by consequence and relevance, then exactly two meaningfully different Alternatives. A directly relevant blocker may lead; unrelated Attention remains visible without automatically displacing clear claimed, ready, or Fog work. Recommend `/bearing-planning-audit` first only when whole-picture judgment is needed and no clearer frontier exists. Completion: three distinct directions are evidence-backed and none performs work.
4. **Set semantic coverage.** Use `complete` from a fresh complete Audit, `partial` from a fresh incomplete Audit, and `absent` when Audit is missing or stale. Include `Based on audit: planning-audit:current` and the Audit in Inputs only for partial or complete coverage. Completion: the recommendation does not overclaim semantic analysis.
5. **Write the snapshot.** Re-read inputs and write only `.bearing/state/next-work-guidance.md` with `Type: next-work-guidance`, `ID: next-work-guidance:current`, `Generated at`, ordered `Inputs`, `Input fingerprint`, and `Semantic coverage`. Under `## Primary Recommendation`, write exactly one `### <plain-text title>`, one or more plain-text rationale paragraphs, then `#### Supporting References` with one or more unique `- \`<stable Bearing ID or repository-relative locator>\`` entries. Under `## Alternatives`, write exactly two items using that same H3 title, rationale, and H4 supporting-reference structure. Normalized titles and rationales use plain UTF-8 without Markdown or HTML links, code spans, emphasis, block quotes, code blocks, comments, or other formatting syntax; the backtick list under Supporting References is structural syntax and remains required. Do not encode title or evidence by relying on the first sentence, inline paths, Markdown links, or prose inference. Preserve `Generated at` on an identical semantic rerun. Completion: recommendation shape, coverage, inputs, and fingerprint validate.
6. **Refresh orientation.** Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` and verify the current Guidance node appears. Completion: the result is visible separately from Audit and Attention.

## Read Set

- Global protocol, manifest, Project Summary, and Project Sitemap
- Trustworthy frontiers and their canonical sources
- Fresh Planning Audit when available
- Relevant diagnostics, Checks, Reviews, Assets, Fog, Maps, and Tickets

## Write Set

Only `.bearing/state/next-work-guidance.md`, followed by disposable sync outputs. Never claim, start, assign, reprioritize, choose an executor, or mutate native work.

## Outcomes

- `applied`: a valid current Guidance snapshot was written and synced.
- `no-op`: `no-managed-frontier` or an identical current Guidance needs no replacement.
- `blocked`: diagnostics leave no trustworthy recommendation set despite managed scope.

`awaiting-decision` and `incomplete` are not Next Work outcomes.

## Recovery

Exclude stale Audit rather than blocking a clear operational frontier. If source inputs change, rerank from current truth. Restore the previous Guidance on write failure. A blocked Bearing recommendation returns control to the governing runbook; it does not terminate unrelated work.

## Completion Criterion

The user receives one evidence-backed primary direction and two distinct alternatives, semantic coverage is honest, no work was started or mutated, and empty managed evidence never ends the original request.

# Bearing Planning Audit

Produce one current whole-project semantic snapshot and promote material questions without deciding them. This internal branch continues from established public orientation and never re-enters the public router.

## Process

1. **Discover scope.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`. If uninitialized, compose the Setup branch and resume. Discover Roadmaps, Gates, bound Efforts, Authorities, Assets, persistent Checks and Reviews, and each bound scope's native Map and Tickets. If no managed scope exists, return `no-op` with reason `no-managed-scope`, write no advisory snapshot, and continue the user's original request. Completion: every included or absent scope is explicit.
2. **Refresh structure.** Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>`. Accept Structural Diagnostics only when their ordered Inputs and fingerprint match current discovery. Exclude scopes affected by blocking diagnostics and record them as skipped; if nothing trustworthy remains, return `blocked`. Completion: semantic coverage has a freshness-backed boundary.
3. **Audit semantics.** Evaluate cross-Roadmap balance, Gate coherence, Effort alignment, Authority use, Asset adoption and zero-citation signals, unresolved Attention, stale direction, and contradictions between accepted current intent and recent durable work. Separate ordinary observations from Material Findings. Completion: each finding names evidence, affected scope, consequence, and confidence boundary.
4. **Promote decision points.** Create or refresh an open Alignment Check for each target-scoped Material Finding and a pending Planning Review for each project-wide Material Finding. Promotion needs no Accepted Decision but never resolves the concern, invokes the Planning Review branch, or mutates accepted direction. Completion: every promoted finding has exactly one durable decision point.
5. **Write the snapshot.** Re-read the post-promotion graph. Write only `.bearing/state/planning-audit.md` plus promoted or refreshed unresolved decision points. Use `Type: planning-audit`, `ID: planning-audit:current`, `Generated at`, ordered `Inputs`, `Input fingerprint`, `Coverage: complete | incomplete`, and `Skipped targets`; keep findings in the body. `Coverage: complete` requires an empty unique `Skipped targets` list, while `incomplete` requires at least one unique skipped planning reference. Author the exact body contract below. Completion: coverage, skipped targets, promotions, and final fingerprint validate together.
6. **Refresh orientation.** Run centralized sync and verify current Audit, open Checks, pending Reviews, and Attention appear in the Project Sitemap. Completion: Bearing can display the whole-picture result separately from Next Work.

## Read Set

- Established public orientation, including manifest, Summary, and current Sitemap; do not reload it
- Planning Audit discovery set: canonical governance objects, persistent Checks and Reviews, bound Maps and Tickets, and referenced Asset contents
- Fresh `.bearing/cache/sync-report.md`

## Write Set

- `.bearing/state/planning-audit.md` when managed scope is trustworthy
- Open `.bearing/state/alignment-checks/*.md` promoted or refreshed by this audit
- Pending `.bearing/state/planning-reviews/*.md` promoted or refreshed by this audit
- Disposable sync outputs

## Audit Body Contract

The body has exactly one `# Planning Audit` heading followed by exactly one `## Findings` section. With zero findings, the section body is the sole sentinel `No material findings.` and contains no H3 finding.

Each finding uses `### <plain title>`, immediately followed by plain summary prose and these H4 sections in exact order:

1. `#### Affected References` with one or more unique `- \`planning-reference\`` entries.
2. `#### Evidence Sources` with one or more unique `- \`repository-relative-source-locator\`` entries.
3. `#### Consequence` with plain prose.
4. `#### Confidence Boundary` with plain prose.

An optional final `#### Promotion` section contains exactly one of `Alignment Check: \`alignment-check:...\`` or `Planning Review: \`planning-review:...\``. A promotion records the canonical decision path created or refreshed by this capability; it does not accept or resolve that decision. Do not add other H2 or H4 sections, markup in semantic prose, or severity, priority, or risk fields.

## Outcomes

- `applied`: a current complete or incomplete Audit and any promotions validate.
- `no-op`: `no-managed-scope` or an identical current snapshot needs no replacement.
- `blocked`: no trustworthy semantic scope or valid snapshot transaction exists.
- `incomplete`: a snapshot was written with explicit skipped targets and partial coverage.

`awaiting-decision` is not an Audit outcome; the promoted Check or Review carries that state.

## Recovery

Do not write an empty Audit for absence. If inputs change before write, recompute findings and promotions. On partial failure, restore the prior Audit and every affected decision point. Never convert an unresolved Material Finding into prose-only history.

## Completion Criterion

The current semantic snapshot has a truthful managed scope, current structural foundation, explicit coverage, evidence-backed findings, exactly scoped promotions, no accepted mutation, and a refreshed Sitemap projection.

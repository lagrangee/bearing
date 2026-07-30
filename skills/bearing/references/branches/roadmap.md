# Bearing Roadmap

Own long-horizon direction and ordered Gate horizons without becoming a work breakdown. This internal branch continues from established public orientation and never re-enters the public router.

## Process

1. **Orient.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`. If `.bearing/manifest.json` is absent, compose the Setup branch and resume. Consume the established Project Summary and complete Sitemap orientation without reloading them. Read the incremental Roadmap Index, candidate Roadmaps, ordered Gates, bound Efforts, relevant Authorities and Assets, diagnostics, open Checks, and pending Reviews. With multiple plausible Roadmaps, require an explicit target rather than guessing from recency. Completion: one Roadmap action and its affected horizon are explicit.
2. **Test the boundary.** Use a separate Roadmap only for an independently governed outcome horizon with its own Gate sequence. Use separate Efforts for parallel work sharing one horizon. Roadmaps remain peers and may relate without nesting. Completion: create, revise, extend, complete, supersede, reorder, or refocus is justified.
3. **Build the candidate.** A Roadmap uses `Type: roadmap`, `ID: roadmap:<slug>`, `Title`, `Status: active | completed | superseded`, `Focused gate`, ordered `Gate order`, optional `Citations`, and `## Intent`. Creation records `Started at`; completion records `Completed at`; supersession records `Superseded at`. Each newly accepted event receives current UTC Source Event Time from this capability inside the same atomic canonical mutation; existing event fields remain immutable, and legacy missing history stays `Time unavailable` without inference. Write semantic Intent prose as plain UTF-8 text without inline Markdown, HTML, links, code spans, or formatting tokens. Creation or extension may include new planned Gate files only when their complete initial intent, exit criteria, order, and focus are part of the same accepted horizon. Existing Gate revision or lifecycle remains a Milestone Gate branch prerequisite. Completion: every new ID, event, reference, file, and dependent effect is enumerated.
4. **Check disposition.** Before completion or supersession, enumerate active or planned Gates, unresolved Efforts, open Checks, pending Reviews, and dependent references. Existing Gate passage or supersession remains owned by the Milestone Gate branch. Supersession names a replacement Roadmap. Completion: no dependency is silently orphaned.
5. **Obtain the decision.** Present intent, rationale, ordering, focus, consequences, and exact write set. Roadmap creation and every material lifecycle, ordering, or focus change require an Accepted Decision. Completion: accepted scope is precise or the outcome is `awaiting-decision`.
6. **Apply the transaction.** Re-read all decision inputs. Write the Roadmap file, Roadmap Index, and accepted new planned Gates. Require any Effort binding disposition through the Alignment Check branch before this transaction; never write Effort sidecars here. Preserve native Maps and Tickets. Validate unique IDs, references, lifecycle, Gate order, focused Gate, and required sections. Completion: the entire accepted graph validates.
7. **Refresh orientation.** Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` and inspect Roadmap Horizon plus affected diagnostics. Completion: the Sitemap reflects the accepted horizon.

## Read Set

- Established public orientation, including manifest, Project Summary, and Project Sitemap; do not reload it
- `.bearing/state/roadmap-index.md`
- Target and candidate Roadmaps and their Gates
- Bound Efforts and materially relevant Authorities, Assets, Checks, Reviews, and diagnostics

## Write Set

- `.bearing/state/roadmap-index.md`
- The target `.bearing/state/roadmaps/<slug>.md`
- Accepted initial or extension `.bearing/state/milestone-gates/<slug>.md`
- Disposable sync outputs

Never mutate Map, Ticket, claim, blocker, or native resolution state.

## Outcomes

- `applied`: the accepted Roadmap graph validates and is synced.
- `no-op`: current horizon already matches the requested decision.
- `awaiting-decision`: target, horizon, ordering, focus, or disposition remains unresolved.
- `blocked`: required Gate lifecycle or invalid structure prevents a trustworthy transaction.

## Recovery

Changed decision inputs invalidate the candidate. On write or validation failure, restore every original target and remove only transaction-created files. Return required Gate prerequisites by capability name rather than performing them under Roadmap ownership.

## Completion Criterion

One independently governed outcome horizon has an accepted, internally valid Gate sequence and focus; all affected dependencies are dispositioned; native work is unchanged; and the refreshed Sitemap agrees with canonical sources.

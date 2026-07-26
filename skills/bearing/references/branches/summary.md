# Bearing Summary

Maintain the accepted project-level synthesis without turning it into a backlog or replacing canonical detail. This capability may be invoked directly or composed by `/bearing` for a current user request. It is the sole mutation owner of Project Summary.

## Process

1. **Establish scope.** Read `$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md`. If `.bearing/manifest.json` is absent, compose `/bearing-setup` and resume. Read the existing Summary, complete Sitemap, relevant canonical sources, accepted decisions, latest prompt, and recent conversation. Completion: each candidate statement has a source or is clearly user-supplied.
2. **Classify the change.** Place accepted project intent in Purpose, accepted present architecture or product shape in Current Design, durable exclusions and ownership rules in Boundaries, explicit "save for later" ideas in Future Candidates, and accepted material changes in Material Revisions. A Future Candidate records an idea but does not adopt it, schedule it, create Fog, or create a Roadmap. Completion: every proposed line belongs to exactly one section.
3. **Propose the semantic diff.** Show additions, replacements, removals, and any source contradictions. Purpose, Current Design, Boundaries, and Material Revisions require an Accepted Decision when materially changed. An explicit request to save an idea for later is sufficient to add a lightweight Future Candidate. Completion: the user can distinguish current truth from deferred possibility.
4. **Apply the transaction.** Re-read inputs and write only `.bearing/state/project-summary.md`. Use frontmatter `Type: project-summary`, `ID: project-summary:current`, and `Title`; require `## Purpose`, `## Current Design`, `## Boundaries`, `## Future Candidates`, and `## Material Revisions`. Keep Future Candidates as bullets without IDs or lifecycle. When a prose section's authored language differs from the surrounding default, declare only that known part in optional frontmatter:

   ```yaml
   Languages:
     Purpose: zh-CN
     Current Design: zh-CN
   ```

   Values are canonical BCP-47 language tags. Omit an unknown part or the whole mapping; missing metadata makes consumers inherit their surrounding language. Never infer language from characters, prose, repository locale, or another section, and treat invalid metadata as an invalid scoped Summary. Write prose and list items as plain UTF-8 text without inline Markdown, HTML, links, code spans, or formatting tokens; original source formatting remains available separately. Use one unique list item per physical line. Leave a list section empty when it has no entries instead of inventing placeholder prose. Completion: schema, section meaning, language metadata, and accepted scope validate.
5. **Refresh orientation.** Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` and verify the Summary is in the Sitemap input manifest. Completion: subsequent `/bearing` orientation sees the revision.

## Read Set

- Global protocol and `.bearing/manifest.json`
- Existing `.bearing/state/project-summary.md`
- Complete Project Sitemap and relevant canonical sources
- Accepted decision records, latest prompt, and recent conversation

## Write Set

Only `.bearing/state/project-summary.md`, followed by disposable sync outputs. Setup never creates an empty or invented Summary.

## Outcomes

- `applied`: an accepted synthesis or explicit Future Candidate was written and synced.
- `no-op`: the current Summary already expresses the requested synthesis.
- `awaiting-decision`: a material current-design, purpose, boundary, or revision claim is still a candidate.
- `blocked`: sources conflict or the transaction cannot validate safely.

## Recovery

When sources disagree, preserve the existing Summary and present the contradiction for decision. On concurrent change, invalidate the proposal and recompute. On write failure, restore the previous bytes and report the current file state.

## Completion Criterion

The Project Summary is concise, source-grounded, internally consistent, explicit about current truth versus Future Candidates, and visible to the refreshed `/bearing` orientation.

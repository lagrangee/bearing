# Matt upstream contract inputs

These test inputs preserve the inspected upstream contract at
[`mattpocock/skills@c55ee460`](https://github.com/mattpocock/skills/tree/c55ee46073ed923f86ce59a5eb3b6d895095d1b7).
They are source data, not installed Skills, authored work, or an alternative Live Matrix.

`source-receipt.json` binds the complete source snapshots to official Git blob identities and
SHA-256 hashes. The five template files are unchanged line-range extracts of those snapshots.
The Local and GitHub tracker seeds and triage vocabulary are copied in full. The receipt test
checks actual bytes and extracts offline; it does not infer compatibility from a hard-coded
description of our own fixture.

Provider tests may fill placeholders or select the template's explicit alternatives. Keep the
distinction visible in each test: omitting an optional Parent is upstream behavior; adding a
mandatory parent Spec, a Local Map Status, a Local Spec H1, or a Completion evidence section is
not an upstream requirement. Setup omits triage configuration when triage is not installed.

The existing Live Matrix materializations remain separate. Their provenance retains their
original source hashes, adds the current upstream revalidation baseline, and labels the
additional repository rules as project extensions. They were not regenerated or regraded by
adding these inputs. No fixed Scenario intent, prompt, or terminal oracle is changed here.

When the relevant Matt installation changes, compare the changed official source clauses and
review the affected Provider tests before updating this pinned receipt. A byte change requires
review, not automatic rejection of users' native work or a runtime version gate. Preserve
accepted historical forms as separate compatibility cases. Never regenerate native fixtures
inside a Live Matrix Generation.

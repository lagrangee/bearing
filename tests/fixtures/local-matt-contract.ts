export const LOCAL_MATT_CONTRACT = `# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in \`.scratch/\`.

Provider contract: \`matt-skills/v1\`

## Conventions

- One feature per directory: \`.scratch/<feature-slug>/\`
- The PRD is \`.scratch/<feature-slug>/PRD.md\`
- Implementation issues are one file per ticket at \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`, numbered from \`01\`
- Triage state is recorded as a \`Status:\` line near the top of each issue file (see \`triage-labels.md\` for the role strings)
- Comments and conversation history append to the bottom of the file under a \`## Comments\` heading

## When a skill says "publish to the issue tracker"

Create a new file under \`.scratch/<feature-slug>/\` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by \`/wayfinder\`. The map is a file with one child file per ticket.

- Map: \`.scratch/<effort>/map.md\` - the Notes / Decisions-so-far / Fog body.
- Child ticket: \`.scratch/<effort>/issues/NN-<slug>.md\`, numbered from \`01\`, with the question in the body. A \`Type:\` line records the ticket type (\`research\`/\`prototype\`/\`grilling\`/\`task\`); a \`Status:\` line records \`claimed\`/\`resolved\`.
- Blocking: a \`Blocked by: NN, NN\` line near the top. A ticket is unblocked when every file it lists is \`resolved\`.
- Frontier: scan \`.scratch/<effort>/issues/\` for files that are open, unblocked, and unclaimed; first by number wins.
- Claim: set \`Status: claimed\` and save before any work.
- Resolve: append the answer under an \`## Answer\` heading, set \`Status: resolved\`, then append a context pointer (gist + link) to the map's Decisions-so-far in \`map.md\`.
`;

export const LOCAL_MATT_TRIAGE_LABELS = `# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| \`needs-triage\` | \`needs-triage\` | Maintainer needs to evaluate this issue |
| \`needs-info\` | \`needs-info\` | Waiting on reporter for more information |
| \`ready-for-agent\` | \`ready-for-agent\` | Fully specified, ready for an AFK agent |
| \`ready-for-human\` | \`ready-for-human\` | Requires human implementation |
| \`wontfix\` | \`wontfix\` | Will not be actioned |

When a skill mentions a role, use the corresponding label string from this table.
`;

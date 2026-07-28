export const LOCAL_MATT_CONTRACT = `# Issue tracker: Local Markdown

## Conventions

- One feature per directory: \`.scratch/<feature-slug>/\`
- The spec is \`.scratch/<feature-slug>/spec.md\`
- Implementation issues are one file per ticket at \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`, numbered from \`01\`
- Triage state is recorded as a \`Status:\` line near the top of each issue file (see \`triage-labels.md\` for the role strings)
- Comments and conversation history append to the bottom of the file under a \`## Comments\` heading

## When a skill says "publish to the issue tracker"

Create a new file under \`.scratch/<feature-slug>/\` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

- Map: \`.scratch/<effort>/map.md\` - the Notes / Decisions-so-far / Fog body.
- Child ticket: \`.scratch/<effort>/issues/NN-<slug>.md\`, numbered from \`01\`, with the question in the body.
`;

export const LOCAL_MATT_TRIAGE_LABELS = `# Triage Labels

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| \`needs-triage\` | \`needs-triage\` | Evaluate |
| \`needs-info\` | \`needs-info\` | Waiting |
| \`ready-for-agent\` | \`ready-for-agent\` | Ready |
| \`ready-for-human\` | \`ready-for-human\` | Human |
| \`wontfix\` | \`wontfix\` | Rejected |
| \`bug\` | \`bug\` | Defect |
| \`enhancement\` | \`enhancement\` | Feature |
`;

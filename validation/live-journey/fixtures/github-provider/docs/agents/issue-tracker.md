# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line
  bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also
  fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq
  '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with
  appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- Give every new delivery scope a concise, human-readable business name. Do not invent synthetic
  Candidate or test keys.
- Do not change historical issues or unrelated repository settings.

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with
`gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in this repository.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` in this repository.

## Canonical delivery shape

A parent delivery scope and its delivery child use both GitHub-native relations and these body
fallbacks. The two representations must agree.

The parent and child are both canonical Deliveries. Each contains:

```markdown
## What to build

<the accepted delivery outcome>

## Acceptance criteria

- [ ] <one observable acceptance condition>

## Completion evidence

<the commit, validation, and remote delivery evidence>
```

The parent also contains `Blocked by: #<delivery-child-number>`. The child also contains `Part of:
#<parent-number>`.

Use GitHub's native sub-issue relation from parent to child and its native blocked-by relation from
parent to child. Keep acceptance criteria as task-list items so their current state is observable.

Create native relations with GitHub's REST API. Add a sub-issue with
`POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues` and the target Issue database ID in
the integer `sub_issue_id` field. Add a blocked-by relation with
`POST repos/<owner>/<repo>/issues/<blocked-number>/dependencies/blocked_by` and the blocking Issue
database ID in the integer `issue_id` field. Each target database ID must belong to this repository.
Do not use GraphQL, an extension, or the body fallback as a substitute for either native relation.
Read the integer ID from the REST issue resource, not `gh issue view --json id`:

```bash
CHILD_DATABASE_ID=$(gh api repos/<owner>/<repo>/issues/<child-number> --jq .id)
gh api --method POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues \
  -F sub_issue_id="$CHILD_DATABASE_ID"
gh api --method POST repos/<owner>/<repo>/issues/<parent-number>/dependencies/blocked_by \
  -F issue_id="$CHILD_DATABASE_ID"
```

An accepted executable parent starts with the repository's `ready-for-agent` label before the
first provider capture. Do not return an already accepted executable scope to `needs-triage`.

After successful delivery validation, check every acceptance item and write non-empty completion
evidence before closing the delivery child with the completed disposition. When that child is the parent's
only delivery work and no unfinished work remains in the accepted scope, complete the parent too.
Check the parent's acceptance items and record its completion evidence before closing it. Preserve
the native relations and body fallbacks. Native parent completion is a Work Management effect; it
does not conclude a Bearing Effort, pass a Gate, or complete a Roadmap.

Create local commits as evidence when needed, but push the delivery branch once, after
implementation, native completion, and Bearing synchronization are all recorded.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog
  body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues
  endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put
  `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving
  dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation.
  Add an edge with `gh api --method POST
  repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where
  `<blocker-db-id>` is the blocker's numeric **database id** (`gh api
  repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports
  `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies
  aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A
  ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the
  map's sub-issues / task list), drop any with an open blocker
  (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an
  assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a
  context pointer (gist + link) to the map's Decisions-so-far.

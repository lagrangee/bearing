# Issue tracker: GitHub

## Conventions

- Use the `gh` CLI for GitHub tracker reads and writes.
- Give every new delivery scope a concise, human-readable business name. Do not invent synthetic
  Candidate or test keys.
- Do not change historical issues or unrelated repository settings.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue in this repository.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` in this repository.

## Canonical delivery shape

A parent delivery scope and its delivery child use both GitHub-native relations and these body
fallbacks. The two representations must agree.

The parent body contains:

```text
Blocked by: #<delivery-child-number>
```

The delivery child body contains:

```markdown
Part of: #<parent-number>

## What to build

<the accepted delivery outcome>

## Acceptance criteria

- [ ] <one observable acceptance condition>
```

Use GitHub's native sub-issue relation from parent to child and its native blocked-by relation from
parent to child. Keep acceptance criteria as task-list items so their current state is observable.

Create native relations with GitHub's REST API. Add a sub-issue with
`POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues` and the target Issue database ID in
the integer `sub_issue_id` field. Add a blocked-by relation with
`POST repos/<owner>/<repo>/issues/<blocked-number>/dependencies/blocked_by` and the blocking Issue
database ID in the integer `issue_id` field. Each target database ID must belong to this repository.
Do not use GraphQL, an extension, or the body fallback as a substitute for either native relation.

After successful delivery validation, complete the delivery child. When that child is the parent's
only delivery work and no unfinished work remains in the accepted scope, complete the parent too.
Preserve the native relations and body fallbacks. Native parent completion is a Work Management
effect; it does not conclude a Bearing Effort, pass a Gate, or complete a Roadmap.

## Wayfinding operations

Use one root issue with child issues. Claim, blockers, dependencies, evidence, answers, and
resolution remain GitHub-native work-management effects.

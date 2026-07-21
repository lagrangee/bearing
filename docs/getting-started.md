# Getting started

[简体中文](getting-started.zh-CN.md)

This guide gets you to the first real Bearing alignment loop.

## Prerequisites

- macOS for the verified Preview path.
- Node.js release line selected by the current release candidate.
- Codex for the verified path. Claude Code is a target surface pending maintainer verification.
- A Git repository you actively work on.
- The supported Matt-native local Markdown Map and Ticket workflow, or a willingness to create one before expecting strong first value.

## Install

```bash
npx @lagrangee/bearing
```

Use the no-argument wizard for normal installation. It previews managed targets before writing. It installs user-level CLI and skill assets; it does not initialize every repository automatically.

## Enable one repository

In your target repository, ask your agent:

```text
Set up Bearing for this project. Use the existing Map and Tickets as work context, and guide me through the minimum governance baseline.
```

If you use the CLI directly, prefer help output from the installed version:

```bash
bearing --help
bearing setup --repo . --surface agent-skills
```

## Establish the minimum baseline

The useful baseline is intentionally small:

1. Project Summary: what the project is, what is currently true, and what is out of bounds.
2. Roadmap: one active long-horizon outcome.
3. Milestone Gate: the focused decision boundary for current progress.
4. Effort: one binding from existing Map or Ticket work to the Roadmap and Gate.

Bearing should ask before accepting direction. If the agent silently invents strategic truth, stop and ask it to surface assumptions as decisions.

## Complete the first alignment loop

Bring one real request:

```text
Before we start, check this against the current direction, accepted decisions, and active work. Surface any conflict before acting.
```

The loop succeeds when the agent either:

- explains why the request fits the current direction and active work; or
- identifies a material conflict and gives explicit decision paths before implementation.

## Inspect the shared picture

```bash
bearing sync --repo .
bearing portal
```

Portal is read-oriented. Use it to inspect what the agent is using, not to replace Agent Surface decisions or native ticket work.

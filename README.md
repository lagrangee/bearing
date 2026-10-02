# Bearing

<a id="stay-on-the-same-page-with-your-coding-agents"></a>

## Let Wayfinder chart the work. Keep the project in view.

Bearing adds local-first project governance to [Matt Pocock's skills](https://github.com/mattpocock/skills). It connects Wayfinder Maps and delivery work to the project's direction, milestones, and decision evidence.

Keep using the workflow you know. Bearing helps you and your coding agent see why each piece of work matters, how it relates to the rest, and what still needs a decision.

Open-source Public Preview · macOS · Local Markdown · MIT

[Try the Portal demo](https://lagrangee.github.io/bearing/) · [Get started](#quickstart-complete-one-real-alignment-loop) · [中文 README](README.zh-CN.md)

## The aha moment

You have a Wayfinder Map for onboarding, another for billing, and a third for performance. Each has a destination and a record of decisions. Now you need to answer a project-level question:

> Which of these efforts brings us closer to the next milestone? Does adding team accounts still fit the direction we agreed on?

Bearing connects the work you select to an accepted Roadmap and Milestone Gates. You and your agent can trace a Map back to the commitment it serves, inspect the evidence, and decide whether to continue, change direction, or take on a separate goal.

Wayfinder preserves the route through an effort. Bearing keeps that effort connected to the whole project.

## What Bearing connects

| When you need to… | Bearing helps you… |
| --- | --- |
| Understand how several Maps fit together | Follow each selected effort back to its project direction and milestone. |
| Decide whether a new request fits | Inspect relevant planning and work, then surface conflicts and decision paths. |
| Review progress | Connect Efforts, native Maps and Tickets, evidence, and human acceptance without treating them as the same status. |
| Understand what your agent is using | Read the project's planning lineage, source provenance, and attention items in the local Portal. |

A typical Wayfinder-based project looks like this:

```text
Roadmap — the project direction
  └─ Milestone Gate — the outcome to prove
      ├─ Effort — one accepted commitment
      │   └─ Wayfinder Map and related native work
      └─ Effort — another accepted commitment
          └─ Wayfinder Map and related native work
```

An **Effort** is Bearing's unit for one accepted work commitment. When you bring a Wayfinder effort into Bearing, the Map's native work scope connects to that Effort. The Map continues to organize exploration and decisions; the Effort records why the work exists and which project milestone it serves.

A resolved Map can lead into specification and delivery while the Effort continues. Ticket completion and acceptance remain visible as separate facts. You choose which work to include; planned Efforts and direct delivery work can also exist without a Map.

### Alongside Matt's workflow

- **Wayfinder** works through the unknowns and retains decisions in a Map.
- **Specification and ticket skills** turn accepted decisions into delivery work when needed.
- **Your executor** implements and verifies that work.
- **Bearing** connects these activities to project direction, milestones, and evidence. Its local Portal lets you inspect the same picture your agent uses.

The supported Public Preview path reads Matt-native local Markdown Maps, Specs, and Tickets. Your tracker keeps its native files, status, dependencies, claims, and resolution rules. Bearing's Portal is read-oriented; canonical planning decisions stay in the agent conversation.

## Quickstart: complete one real alignment loop

You need macOS, Node.js 24.15.0 or later, a coding agent that can install packages and integrate a skill, and a real Git project. The supported work-management path uses Matt-native local Markdown Maps and Tickets.

### 1. Ask your agent to install Bearing

```text
Install Bearing from https://github.com/lagrangee/bearing. Follow the repository's Agent installation guide, use the released package, integrate the Bearing skill with your Skill Directory, and stop before repository setup.
```

The [Agent installation guide](docs/agent-installation.md) verifies one exact published package and separates installation, skill integration, and repository setup. It does not install from mutable `main` as the normal payload.

If your agent cannot install it, first verify an exact released version and its package identity, then use the terminal fallback:

```bash
npx --yes @lagrangee/bearing@<resolved-version> install
```

Installation prints PATH guidance without changing your shell profile. See [Getting started](docs/getting-started.md) and [Troubleshooting](docs/troubleshooting.md) for setup and recovery.

### 2. Enable Bearing in your project

Open the project with your agent and ask:

```text
Set up Bearing for this project. Help me connect one existing Wayfinder Map and its work to the project's direction and milestones. Show me the proposed scope and planning baseline before applying them.
```

Start with a Project Summary, a Roadmap and Milestone Gate, and an Effort connecting the selected work to that Gate. Use a Map you actually work with. Your agent should make proposed direction and scope visible for your decision; repository files alone do not accept a plan.

### 3. Bring one real request

```text
Before we start, check this against the current direction, accepted decisions, and active work. Surface any conflict before acting.
```

The first useful loop is complete when your agent explains how the request fits or surfaces a material conflict with clear decision paths.

### 4. Inspect the shared picture

```bash
bearing inspect project --repo .
bearing portal
```

Open the loopback URL printed by the Portal Host. Inspect the Project Summary, Roadmaps and Gates, contributing Efforts, Attention, and source provenance. Advanced usage is in the [CLI reference](docs/cli.md).

## Is Bearing for you?

Bearing is likely a fit if you already use Matt Pocock's skills, especially Wayfinder, on a software project with several ongoing efforts. It is useful when individual Maps and Tickets are understandable, but their relationship to the project's direction needs to stay visible.

The `0.x` Preview may make documented breaking changes; Linux and Windows are not officially supported today.

One-off tasks with little lasting context may get less value. If you need a hosted issue tracker, Kanban board, autonomous project manager, general memory database, multi-user service, or cloud sync, those are outside the current product boundary.

## Public Preview support

| Area | Public Preview support |
| --- | --- |
| Platform | macOS |
| Node.js | Node.js 24.15.0 or later; CI verifies Node.js 24.15.0 and 26 |
| Work Management Adapter | Matt-native local Markdown Maps and Tickets |
| Telemetry | None. No analytics, crash upload, repository upload, or update polling. |

## Interactive browser sample

[Open the interactive browser sample](https://lagrangee.github.io/bearing/) to explore the Portal with fixed mock Northstar data.

The demo is a static browser sample. It does not start the local Portal Host, read a repository, call a provider or API, use analytics, or persist browser state. It is excluded from the npm package. Demo availability does not prove installation success or product value; real use starts with local installation and a loopback Portal.

## Local-first data and trust boundary

- Canonical project governance lives in `.bearing/state/`; native work stays in its selected local Markdown scope. `.bearing/cache` is disposable projection data.
- The Global Kit and Project Catalog live under your local Bearing home directory.
- Bearing performs no analytics, crash upload, repository upload, or update polling. An explicit install or update check accesses the package registry; feedback leaves your machine only when you submit it.
- Portal's owner-facing Catalog shows absolute repository roots. Redact local paths and private data before sharing screenshots or diagnostics.
- Direct loopback Portal uses HTTP; its session cookie is not marked `Secure`, and restarting the foreground Host invalidates the session.
- Private Tailscale Serve or an owner-managed reverse proxy requires you to manage TLS, authentication, access control, and exposure. Public unauthenticated Internet exposure is unsupported.
- Bearing is a trusted-checkout tool. It is not a filesystem sandbox and does not claim safety against hostile concurrent filesystem mutation.

Read [Data and security](docs/data-and-security.md) and [SECURITY.md](SECURITY.md) before sharing captures or changing private reachability.

## Feedback and support

- [Bug report](https://github.com/lagrangee/bearing/issues/new?template=bug_report.yml) and [Documentation problem](https://github.com/lagrangee/bearing/issues/new?template=documentation.yml): reproducible defects and actionable documentation problems. Blank Issues are disabled.
- [Q&A](https://github.com/lagrangee/bearing/discussions/categories/q-a) and [Ideas](https://github.com/lagrangee/bearing/discussions/categories/ideas): troubleshooting, experiences, and proposals that still need shaping.
- [GitHub private vulnerability reporting](https://github.com/lagrangee/bearing/security/advisories/new): suspected vulnerabilities. Never post them in a public Issue or Discussion.

Issues and Discussions are public GitHub data. Do not submit tokens, secrets, private source, complete planning state, real absolute repository paths, or unredacted screenshots. Share only the smallest redacted excerpt needed. Community support is best-effort with no SLA; public feedback is not a scheduling or delivery commitment.

## Learn, recover, and contribute

[Getting started](docs/getting-started.md) · [Everyday workflows](docs/everyday-workflows.md) · [Troubleshooting](docs/troubleshooting.md) · [CLI reference](docs/cli.md) · [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Third-party notices](THIRD_PARTY_NOTICES)

Bearing is open-source under the MIT License.

# Bearing

## Stay on the same page with your coding agents.

Bearing gives long-running coding-agent projects a local, inspectable project-governance layer. It keeps accepted direction, decisions, evidence, and alignment checks visible to you and your agents, so new work can start from the same project picture instead of from a fragile memory of old chats.

Local-first · Open-source Public Preview · Codex verified path · Claude Code target surface pending maintainer verification · Matt-native local Markdown work management

[Quickstart](#quickstart-complete-one-real-alignment-loop) · [Is Bearing for you?](#is-bearing-for-you) · [Data boundary](#local-first-data-and-trust-boundary) · [中文 README](README.zh-CN.md)

## The aha moment

You ask an agent to do the next thing on an active project:

> Add team accounts next.

A Bearing-aware agent can answer from the current project truth:

> The focused Gate is proving the single-user workflow. The accepted Roadmap puts multi-user authentication later. We can keep the current direction and capture this as future work, revise the Roadmap, or split a separate outcome horizon. I will not treat this as aligned until you choose.

That is the point of Bearing: not perfect agent memory, and not a second task tracker, but continuous alignment confidence. You can feel that the agent is on the same page, and you can see the source of that shared picture.

## What Bearing connects

```text
You + Codex / Claude Code
           ↕
 Bearing Project Governance
           ↕
Matt-native Maps and Tickets

Portal reads the same project picture
```

Bearing owns durable project governance: Project Summary, Roadmaps, Milestone Gates, Effort bindings, Authorities, Assets, Alignment Checks, Planning Audit, and evidence relationships.

Your work-management adapter still owns Maps, Tickets, dependencies, claims, blockers, and resolution. Your executor still owns implementation and verification. Bearing keeps those layers connected without pretending to be all of them.

Already using Matt Pocock's planning workflow? Bearing is designed to read the same local Markdown Map and Ticket shape, so you can add governance and Portal orientation without migrating work into another tracker.

## Is Bearing for you?

Bearing is likely a fit if:

- you use coding agents on software projects that continue across many sessions;
- you want new requests checked against accepted direction before work starts;
- you already use, or are willing to use, the supported Matt-native local Markdown Map and Ticket workflow;
- you want local repository truth, a local Portal, and no automatic telemetry;
- you are comfortable with a macOS-first `0.x` Public Preview that may make documented breaking changes.

Bearing is probably not a fit yet if:

- your work is mostly one-off coding tasks with little durable context;
- you want a Kanban board, hosted issue tracker, autonomous project manager, or general memory database;
- you do not want to use the supported local Markdown work-management adapter;
- you need hosted multi-user operation, product-managed authentication, cloud sync, or a public Internet Portal;
- you need officially supported Linux or Windows today.

## Public Preview support

| Area | Public Preview support |
| --- | --- |
| Platform | macOS |
| Node.js | Node.js 24.15.0 or later; CI verifies Node.js 24 and 26 |
| Agent Surfaces | Codex is verified. Claude Code is a target surface pending maintainer verification. |
| Work Management Adapter | Matt-native local Markdown Maps and Tickets |
| Telemetry | None. Bearing performs no analytics, crash upload, repository upload, or update polling. |

## Feedback and support

- Use [Bug report](https://github.com/lagrangee/bearing/issues/new?template=bug_report.yml) or [Documentation problem](https://github.com/lagrangee/bearing/issues/new?template=documentation.yml) for reproducible bugs and actionable documentation problems. Blank Issues are disabled.
- Use [Q&A](https://github.com/lagrangee/bearing/discussions/categories/q-a) for questions and troubleshooting, and [Ideas & Feedback](https://github.com/lagrangee/bearing/discussions/categories/ideas-feedback) for experiences, scenarios, pain points, suggestions, and feature ideas that still need shaping.
- Report suspected vulnerabilities only through [GitHub private vulnerability reporting](https://github.com/lagrangee/bearing/security/advisories/new), never in a public Issue or Discussion.

Issues and Discussions are public GitHub data. Do not submit tokens, secrets, private source, complete planning state, real absolute repository paths, or unredacted screenshots. Bearing uploads no diagnostics automatically; logs, diagnostics, and repository excerpts are shared only when you explicitly submit them. Community support is best-effort with no SLA, and public feedback is not a scheduling or delivery commitment.

## Quickstart: complete one real alignment loop

### 1. Install Bearing

```bash
npx @lagrangee/bearing
```

The public Preview install path is a no-argument wizard. It previews managed targets before writing, installs the version-compatible CLI and single `bearing` Agent Surface skill, and does not initialize a repository or launch Portal during global installation.

Rerun the same command when you choose to update or repair Bearing. Updates stage one complete bundle
and either switch it as a unit or restore the previous complete bundle. Bearing performs no
background update check. Repository deactivation, repository-state purge, explicit package
downgrade, and package-manager uninstall are separate recovery operations; see
[Troubleshooting](docs/troubleshooting.md).

Advanced users and agents can use explicit commands; see [CLI reference](docs/cli.md).

### 2. Choose a real project

Start with a real Git repository that already has, or is ready to use, the supported local Markdown Map and Ticket workflow. Bearing creates first value when it can connect real direction to real work; an empty toy repository proves very little.

### 3. Ask your agent to set up Bearing

Open the repository in Codex and ask:

```text
Set up Bearing for this project. Use the existing Map and Tickets as work context, and guide me through the minimum governance baseline.
```

The minimum useful baseline is:

- one current Project Summary;
- one active Roadmap and focused Milestone Gate;
- one Effort that binds an existing Map or Ticket scope to that Gate.

Accepted direction remains a human decision. Setup should not infer governance truth from repository files without asking.

### 4. Bring one real request

Ask something you actually want to do next:

```text
Before we start, check this against the current direction, accepted decisions, and active work. Surface any conflict before acting.
```

The first alignment loop is complete when the agent either explains how the request fits or exposes a material conflict with explicit decision paths. Installation success alone is not the value milestone.

### 5. Sync and inspect

```bash
bearing sync --repo .
bearing portal
```

Open the loopback URL printed by the Portal Host and inspect the Project Summary, focused Roadmap and Gate, contributing Effort, Attention, and source provenance.

## Local-first data and trust boundary

- Repository governance truth lives under the repository's Bearing state and native local Markdown work scope.
- User-level installation and Project Catalog data live under the user's Bearing home directory.
- `.bearing/cache` is disposable projection data; source truth remains in canonical state and native work files.
- Portal's owner-facing Catalog API and UI show absolute repository roots. Screenshots and user-shared diagnostics may therefore reveal local paths and must be redacted before sharing.
- Direct loopback Portal uses HTTP, so its session cookie is not marked `Secure`; restarting the foreground Portal Host invalidates the session.
- Private Tailscale Serve or an owner-managed reverse proxy may provide private reachability, but the owner is responsible for TLS, authentication, access control, and exposure. Public unauthenticated Internet exposure is unsupported.
- Bearing is a local trusted-checkout tool. It is not a filesystem sandbox and does not claim safety against hostile concurrent filesystem mutation.

Read more in [Data and security](docs/data-and-security.md) and [SECURITY.md](SECURITY.md).

## Learn, recover, and contribute

- [Getting started](docs/getting-started.md)
- [Everyday workflows](docs/everyday-workflows.md)
- [Data and security](docs/data-and-security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [CLI reference](docs/cli.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Third-party notices](THIRD_PARTY_NOTICES)

Bearing is open-source under the MIT License.

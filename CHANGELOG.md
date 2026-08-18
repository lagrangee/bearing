# Changelog

All notable changes to Bearing are recorded here.

GitHub Release notes are generated from the matching version section. `main` is the integration baseline, not a release identity. A maintainer-selected Candidate remains unpublished evidence until the matching immutable Git tag, npm version, and GitHub Release establish the formal release identity.

## 0.1.1 - 2026-08-12

Bearing 0.1.1 strengthens the Public Preview around Agent-managed setup, typed project inspection,
and repeatable release validation.

### Added

- Agent-mediated installation from the public README through the package-owned installation guide,
  complete bundle install, Agent Skill Directory integration, and explicit project setup handoff.
- A reusable behavior-driven Codex Live Matrix with independent Scenarios, exact package identity,
  Coordinator semantic evaluation, and separate Human-run Claude Code and WorkBuddy compatibility
  lanes.
- Read-only public release verification for npm provenance, immutable GitHub release identity,
  Pages source, and public user-entry routes.

### Changed

- `main` is the protected integration baseline with six required CI contexts and manual,
  exact-source Candidate Freeze.
- Project inspection and Portal now use one typed, disposable Project Read Model while canonical
  Bearing State and tracker-native work keep their existing owners.
- Repository Configuration now uses explicit Inspect, Plan, and Apply operations with lifecycle
  validation and managed Agent Surface pointers.
- The public static demo, feedback routes, support boundary, and private vulnerability-reporting
  guidance now use one consistent disclosure.
- The minimum supported Node.js version is now 24.15.0. CI verifies Node.js 24 and 26.

### Compatibility

- Public JavaScript API: none. The supported surface is the `bearing` CLI and package-owned Agent
  Surface bundle.
- Bearing 0.1.1 recognizes the exact 0.1.0 repository source and can return Repository Update
  Required with a package-owned, Human-confirmed semantic update guide. Canonical state already
  matches the target schema and stays byte-for-byte unchanged; the Agent updates the named manifest
  fields and rebuilds, rather than migrates, the disposable Project Read Model.
- Newer repository state requires a newer kit. Unknown, corrupt, or unmatched old state remains
  unchanged and Unsupported. Bearing does not provide a generic migration engine, downgrade,
  dual-read, or compatibility fallback, and detection never authorizes automatic deletion.
- Public Preview versions may make documented breaking changes.

## 0.1.0 - 2026-07-21

Initial Public Preview release.

### Added

- Local-first Bearing project-governance CLI, protocol, templates, and Agent Surface skills.
- No-argument install/update wizard for the version-consistent CLI, protocol, template, and skill bundle.
- Codex/Agent Skills installation path.
- Claude Code target surface pending maintainer verification.
- Deterministic sync, inspect, catalog, setup, and loopback Portal commands.

### Compatibility

- Installable Node.js engines: `>=22`.
- Verified Public Preview CI matrix: Node.js 22 and 24.
- Verified Preview platform: macOS.
- Public JavaScript API: none. The supported surface is the `bearing` CLI and package-owned Agent Surface bundle.
- Public Preview versions may make documented breaking changes.

# Changelog

All notable changes to Bearing are recorded here.

GitHub Release notes are generated from the matching version section. `main` is the integration baseline, not a release identity. A maintainer-selected Candidate remains unpublished evidence until the matching immutable Git tag, npm version, and GitHub Release establish the formal release identity.

## 0.1.2 - 2026-10-02

Bearing 0.1.2 connects Wayfinder Maps and Matt-native delivery work to project direction,
milestones, and decision evidence, with clearer Agent workflows and faster project inspection.

### Added

- Activity inspection for canonical planning events and their contributing Efforts.
- Package-owned skill integration for existing Agent Skills, Claude, and WorkBuddy directories,
  with one shared installation contract and explicit repository setup handoff.
- A foreground Global Kit update check that verifies one exact package and asks before replacing
  the installed Kit.

### Changed

- One public Bearing skill now routes directly to the owner contracts needed by the current
  operation. Composed workflows retain native admission, owner writeback, and exact reconciliation
  across planning and delivery.
- Project inspection avoids redundant read-model construction and repeated native evidence;
  Portal Find searches titles within Bearing-managed scope.
- Portal shows provider diagnostics and contributing Effort timing without treating delivery
  completion as human acceptance.
- English and Chinese introductions explain how Wayfinder Maps connect to Bearing Efforts while
  preserving Matt-native work and its existing owners.

### Fixed

- Matt provider reads accept the supported native document variants and preserve partial,
  unavailable, and conflicting evidence as distinct outcomes.
- Delivery Tickets marked `wontfix` count as resolved work without claiming their acceptance
  criteria were completed.
- Invalid projection bases are rejected before unrelated native reads; recovery rebuilds the
  disposable Project Read Model without changing canonical planning or native work.

### Compatibility

- Public Preview support remains macOS, Node.js 24.15.0 or later, and Matt-native local Markdown
  Maps, Specs, and Tickets. The supported public surface is the CLI and package-owned Agent skill;
  there is no public JavaScript API.
- Repository manifest schema 2 records explicit Stable or Development runtime meaning. The
  installed target contract guides Human-confirmed updates from safely readable schema-1 state,
  preserving canonical planning, native work, provider configuration, and selected Agent surfaces.
  Unsafe, ambiguous, corrupt, unsupported, or newer state fails closed without automatic repair.
- The Project Read Model is disposable. An incompatible retained projection requires an explicit
  cache rebuild and, when needed, acquisition of the exact bound provider scopes.
- Public Preview versions may make documented breaking changes.

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

# Repository Update

## Applicability

Use only when the requested functional operation returns `repository-update-required` with a
supported source identity, target package version, and this guide from the installed Skill bundle.
The installed Kit defines the target schema. This guide lists every source identity it supports;
unlisted, corrupt, or semantically uncertain state is Unsupported.

## Authority

The Human authorizes one complete visible repository update candidate. The Agent owns semantic
updates to canonical Bearing State and chooses the proportionate edit and safety method.
Deterministic Modules own lifecycle identity, schema validation, contained readback, and rebuilding
the disposable Project Read Model.

Repository Update and Global Kit maintenance have separate owners and write scopes. A
`repository-update-required` result proves that the installed Kit supports this repository update;
it does not authorize or provide evidence for Global Kit maintenance.

## Operation

1. Match the typed source identity to one supported source below. Read its target schema, semantic
   invariants, write scope, and validation. Preserve all repository bytes when the identity is not
   exact. Completion: one supported source contract is selected or the operation stops unchanged.
2. Inspect every candidate write and every invariant before mutation. Show one complete candidate
   with the semantic changes, manifest effect, preserved meaning, disposable cache rebuild, and
   validation. Ask for Human confirmation before any write. A later acceptance is valid only after
   this complete candidate is visible. Completion: one bounded candidate is accepted or the
   repository remains unchanged.
3. Apply the accepted semantic update. The Agent chooses the edit order and proportionate safety
   method; no standard backup format, migration journal, or command sequence is required. Repair
   only its accepted write scope and continue autonomously while the same authority remains valid.
   Completion: current bytes prove the complete old state or the complete target state; otherwise
   stop with one actionable blocked boundary.
4. Validate the complete target schema and every semantic invariant. Rebuild the disposable Project
   Read Model from the validated target state instead of editing or migrating SQLite rows. Internal
   partial facts are not a Human workflow: diagnose and continue within the accepted boundary.
   Completion: the target state and current Project Read Model validate, or one external,
   ambiguous, or new-authority blocker is visible.
5. Retry the original functional operation from current typed facts. Completion: the original
   request completes against the target repository state or stops at the actionable blocker.

## Supported source identities

### Source repository 0.1.1 Active Development Configuration to target Kit 0.1.2-dev

- **Source identity:** `schemaVersion` is `1`, `packageVersion` is `0.1.1`, `status` is `active`,
  `runtime` is `development`, `surfaces` is a non-empty unique list of supported Agent Surfaces,
  `executorProfiles` is a unique list of valid profile IDs, and no other manifest field exists.
  This source is supported only by the exact `0.1.2-dev` Development Kit.
- **Target schema:** Preserve `schemaVersion`, `status`, `runtime`, `surfaces`, and
  `executorProfiles`; set `packageVersion` to `0.1.2-dev`; add no other manifest field.
- **Semantic invariants:** Canonical Bearing State, Provider Configuration, provider-owned native
  work, Execution Profiles, and managed instruction content stay byte-for-byte unchanged.
- **Write scope:** `.bearing/manifest.json` and the disposable Development Project Read Model only.
- **Validation:** Read back the target manifest and every preserved invariant, rebuild the isolated
  Development Project Read Model through `bearing cache rebuild --repo <repo-root>`, then re-run
  lifecycle and diagnostics. The old SQLite file is not update input, and rebuild performs no
  provider acquisition.

### Repository 0.1.0 to target Kit 0.1.1

- **Source identity:** `schemaVersion` is `1`, `packageVersion` is `0.1.0`, `status` is absent,
  `surfaces` is a non-empty unique list of supported Agent Surfaces, `executorProfiles` is a unique
  list of valid profile IDs, and no other manifest field exists.
- **Target schema:** Preserve `schemaVersion`, `surfaces`, and `executorProfiles`; set
  `packageVersion` to `0.1.1`; add `status: active`; add no other manifest field.
- **Semantic invariants:** Every canonical Bearing State record already validates under the target
  schema, so canonical State stays byte-for-byte unchanged. Provider Configuration,
  provider-owned native work, Execution Profiles, and managed instruction content also stay
  byte-for-byte unchanged.
- **Write scope:** `.bearing/manifest.json` and the disposable
  `.bearing/cache/project-read-model.sqlite` only.
- **Validation:** Read back the target manifest and all preserved invariants, rebuild the Project
  Read Model through `bearing cache rebuild --repo <repo-root>`, then re-run lifecycle and
  diagnostics. The old SQLite file is not update input.

## After this operation

- **Required:** `kit-update-required` keeps repository bytes unchanged and routes to a separately
  authorized Global Kit update. It is not a Repository Update source identity.
- **Required:** Unknown bytes, an unlisted source, a missing guide, or semantic uncertainty remains
  Unsupported and unchanged.
- **Do not infer:** Package version alone proves canonical meaning, provider observation, event
  time, or successful update.

## Completion criterion

The accepted source reached the complete target schema with its semantic invariants preserved, the
disposable Project Read Model was rebuilt, and the original functional operation resumed from
current typed readback.

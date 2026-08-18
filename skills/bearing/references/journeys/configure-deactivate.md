# Deactivate Configuration

## Applicability

Use when the user explicitly requests repository deactivation.

## Authority

This variant removes Bearing integration surfaces and disposable cache only. It has no authority to
remove project truth, provider configuration, profiles, artifacts, or native work.

## Operation

1. Present the exact managed pointer and disposable cache removals, preserved canonical state,
   Provider Configuration, profiles, artifacts, and native work, plus the later Catalog unregister
   effect. The repository manifest is retained with `status: deactivated`; it is not deleted or
   removed. Completion: the user accepts the exact boundary.
2. Use the common sealed plan and Apply sequence for deactivation. Then report Catalog unregister as
   an independent stage. Completion: repository lifecycle and Catalog outcome are both explicit.

## After this operation

- **Required:** If Catalog unregister fails, preserve valid repository deactivation and resume only
  the Catalog stage.
- **Do not infer:** Deactivation is not Global Uninstall, repository removal, canonical deletion, or
  native cleanup.

## Completion criterion

The managed pointer and disposable cache are absent, preserved state remains, and Catalog status is
reported independently.

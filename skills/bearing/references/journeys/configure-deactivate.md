# Deactivate Configuration

## Applicability

Use when the user explicitly requests repository deactivation.

## Authority

This variant removes Bearing integration surfaces and disposable cache only. It has no authority to
remove project truth, provider configuration, profiles, artifacts, or native work.

## Operation

1. Present the exact managed pointer and disposable cache removals, preserved canonical state,
   Provider Configuration, profiles, artifacts, and native work. Retain the repository manifest
   with `status: deactivated`; do not delete it.
2. Stop without change unless the Human accepts this exact boundary. Deactivation is not Global
   Uninstall, repository removal, canonical deletion, or native cleanup.

## Completion criterion

The accepted deactivation delta removes only the managed pointer and disposable cache, retains the
deactivated manifest, and preserves every named owner outside that delta.

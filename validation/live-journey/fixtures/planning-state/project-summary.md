---
Type: project-summary
ID: project-summary:current
Title: Label Formatting Fixture
Languages:
  Purpose: en
  Current Design: en
---

# Project Summary: Label Formatting Fixture

## Purpose

Keep label formatting behavior small and deterministic.

## Current Design

One local TypeScript function and its tests define the observable label output.

## Boundaries

- Preserve provider-native work identity.
- Keep package renaming outside the accepted label delivery scope.

## Future Candidates

- Consider an optional prefix only after a separate scope decision.

## Material Revisions

- 2026-08-16: Established the independent Live Scenario planning fixture.

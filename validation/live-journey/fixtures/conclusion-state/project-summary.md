---
Type: project-summary
ID: project-summary:current
Title: Label formatter
---

# Label formatter

## Purpose

Keep primary and secondary status labels consistent for library consumers.

## Current Design

Two exported TypeScript functions normalize label whitespace and casing, with focused tests for their public behavior.

## Boundaries

- Keep package identity and additional formatting policy outside the current delivery.
- Preserve existing consumers when maintaining the label contract.

## Future Candidates

## Material Revisions

- 2026-08-16: Accepted secondary label formatting alongside the existing primary formatter.

# Label Formatter Delivery Map

Status: active

## Destination

Maintain deterministic label formatting through exact native Delivery tickets.

## Notes

- Keep package renaming outside this native scope.
- Preserve actual command failures.

## Decisions so far

- [Update primary output](issues/01-update-output.md) — Keep one bounded primary change.
- [Update secondary output](issues/02-update-output.md) — Keep the secondary behavior separate.

## Fog

- Whether the optional prefix belongs in a future scope.

## Out of scope

- Package identity changes are not part of label delivery.

# Active Configuration

## Applicability

Use when the lifecycle is Active and the user requests configuration change, executor addition or
removal, or ordinary repair.

## Authority

This variant changes only accepted machine configuration. It does not re-run Fresh onboarding.

## Operation

1. Compare requested selections with current Active configuration and preserve every unaffected
   provider, surface, profile, pointer, canonical source, and native source. Completion: the delta
   and preservation set are exact.
2. For executor addition, validate only the user-nominated end-to-end executor. For removal, name
   exact registered profiles. Do not discover, rank, install, prefer, or select a default executor.
   Completion: the executor delta is accepted and contract-valid.
3. Use the common sealed review and Apply sequence. Completion: the requested Active change is
   applied or the current valid configuration remains intact.

## After this operation

- **Required:** Report Catalog and Portal handoff stages independently when they are affected.
- **Consider:** Resume the original request after repair only when its own facts are re-inspected.
- **Do not infer:** Active modification does not offer Fresh Orientation or acquire provider scope.

## Completion criterion

Only the accepted Active configuration delta changed and every unaffected owner remained intact.

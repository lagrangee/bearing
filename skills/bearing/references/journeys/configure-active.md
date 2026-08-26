# Active Configuration

## Applicability

Use when the lifecycle is Active and the user requests configuration change, executor addition or
removal, or ordinary repair.

## Authority

This variant changes only accepted machine configuration. It does not re-run Fresh onboarding.

## Operation

1. Compare requested selections with current Active configuration and preserve every unaffected
   provider, surface, profile, pointer, canonical source, and native source.
2. For executor addition, validate only the user-nominated end-to-end executor. For removal, name
   exact registered profiles. Do not discover, rank, install, prefer, or select a default executor.
3. Stop when the requested delta is absent, invalid, ambiguous, unavailable, or not accepted. Keep
   the current valid configuration intact.

## Completion criterion

The Active variant identified an exact no-op or one accepted delta, preserved every unaffected
owner, did not offer Fresh Orientation or acquire provider scope, and any repaired functional
target is re-inspected before resumption.

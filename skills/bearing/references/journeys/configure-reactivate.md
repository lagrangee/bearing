# Reactivate Configuration

## Applicability

Use when Configure Inspect reports Deactivated and the user explicitly requests reactivation.

## Authority

This variant restores Active integration using preserved repository state; it does not reconstruct
planning or native truth.

## Operation

1. Inspect preserved canonical state, Provider Configuration, profiles, and managed surface choices.
   Resolve only choices that are now invalid or materially changed. Completion: desired Active
   configuration is complete.
2. Use the common sealed review and Apply sequence to restore the managed pointer and disposable
   read model, then perform independent Catalog upsert and Portal handoff. Completion: lifecycle is
   Active or the prior Deactivated state remains truthful.

## After this operation

- **Required:** Re-inspect the original functional target before resuming it.
- **Consider:** The user may explicitly request Project Orientation later.
- **Do not infer:** Reactivation does not replay Fresh onboarding, create a Fresh offer, or acquire
  native evidence.

## Completion criterion

Deactivated state became Active through one reviewed plan while preserved canonical and native
truth remained unchanged.

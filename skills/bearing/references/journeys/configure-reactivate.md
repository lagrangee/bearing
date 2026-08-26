# Reactivate Configuration

## Applicability

Use when Configure Inspect reports Deactivated and the user explicitly requests reactivation.

## Authority

This variant restores Active integration using preserved repository state; it does not reconstruct
planning or native truth.

## Operation

1. Inspect preserved canonical state, Provider Configuration, profiles, and managed surface choices.
   Resolve only choices that are now invalid or materially changed.
2. Set the retained manifest lifecycle to Active and restore only the managed pointer and
   disposable read model. Do not replay Fresh onboarding, create a Fresh offer, acquire native
   evidence, or change preserved canonical and native truth.
3. Re-inspect the original functional target before resuming it. The user may request Project
   Orientation as a separate later operation.

## Completion criterion

The reactivation delta restores Active integration from accepted current choices while preserved
canonical and native truth remain unchanged.

# Project Brief Owner

## Applicability

Use to create or materially refresh the current Project Brief from accepted project truth.

## Authority

Project Brief may compress accepted truth into `At a Glance`, `Current Position`, and `Established
Baseline`. It introduces no new project meaning, recommendation, todo, or future candidate. Portal
renders these exact labeled values and owns no Brief authoring, truncation, regeneration, refresh,
or persistence.

## Operation

1. Inspect Project Context, current Brief, Summary, and accepted terminal planning transitions that
   materially affect orientation. Give every Brief statement accepted support.
2. Apply the shared materiality test. Return `no-op` when the current Brief still provides useful
   orientation.
3. Author the smallest useful synthesis in the current user's language:
   - `At a Glance` uses one sentence to restore the project outcome. It does not repeat Summary
     design, boundaries, future candidates, or a component inventory.
   - `Current Position` names the current Roadmap, Gate, active governing commitment, and only a
     qualifier needed to prevent false orientation. It gives no next frontier, ticket order, PRD
     topology, execution order, or task recommendation.
   - `Established Baseline` uses one to at most five outcome-level accepted facts. It excludes
     ticket inventories, test counts, commit SHA values, session IDs, reconciliation logs, and the
     execution ledger.
   Treat thirty to sixty seconds as a language-neutral soft budget judged through structure and
   materiality. Use no character, word, or token limit and no single-language validator.
4. Set `Generated at` only for the successful synthesis. A failed refresh retains the previous
   Brief and its generation time.

## After this operation

- **Required:** Route new project meaning through its actual owner and acceptance before using it in
  a later Brief refresh.
- **Required:** When root selects this owner after an accepted terminal transition, evaluate the
  current orientation and return either a material refresh or an explicit `no-op`.
- **Consider:** Combine several accepted transitions visible in one operation into one material
  refresh.
- **Do not infer:** Brief text becomes canonical project truth or a work recommendation.

## Completion criterion

The Brief materially compresses only accepted truth, remains distinct from Summary, and retains the
previous successful version and `Generated at` on failure.

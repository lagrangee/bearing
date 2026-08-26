# Scope Review

## Applicability

Use inside a complete Project Orientation that includes existing-work evidence, or for an explicit
whole-project Scope Review. Ordinary contextual work uses only exact native references already in
the request.

## Authority

Scope Review acquires one bounded transient native-work view and makes semantic recommendations.
It does not persist an inventory, decide provider lifecycle, or create a Work Binding.

## Operation

1. Acquire project-level scope and lifecycle summaries first, without loading raw Ticket bodies.
2. Expand active and open work next, then only baseline-relevant completed work. Never default to
   exhaustive history. If the bounded view is insufficient, offer a visibly higher-cost traversal
   instead of performing it silently.
3. Compare exact native facts with accepted Bearing Scope and Work Bindings. State whether work is
   already managed, has at most one material enrollment recommendation, or remains standalone.
   Repository proximity, labels, title similarity, and tracker membership are not enrollment
   evidence.
4. Return the view to Orientation in the same visible operation with no separate outcome, or answer
   the explicit Scope Review. Discard the inventory at close.

## After this operation

- **Required:** A successful accepted Binding change later uses the Effort owner and exact-scope
  baseline acquisition.

## Completion criterion

The review used an explicit evidence depth, remained summary-first and active/open-first, kept each
recommendation transient, and discarded its bounded inventory without persistence or scope
mutation.

# Matt Provider read compatibility

The `matt-skills/v1` Local Markdown Provider uses canonical writers and bounded compatible reads.
The repository's confirmed tracker contract owns native writing. A Provider's inability to read a
form does not establish that the form violates that contract.

This compatibility refinement admits two observed, noncanonical forms:

- A Wayfinder `Status: open` with no claimant, Answer, Map decision or out-of-scope pointer is
  unclaimed and open. Conflicting evidence is not discarded to make the alias work.
- `Blocked by: None — can start immediately.` with exactly one final ASCII period means no
  blockers. Other punctuation and prose suffixes are not admitted by this rule.

Both full capture and ready-basis targeted reconciliation apply the same rules on the first read,
preserving the original native fields and recording normalization evidence. They never rewrite
native files, emit a blocking diagnostic for an accepted normalization, or reduce successful
coverage because the source spelling was noncanonical.

Existing exact-label Markdown forms, historical omissions and numeric blocker identity remain
supported. A stale optional blocker title cannot replace or invalidate a uniquely resolved numeric
identity. Unknown and conflicting evidence remains fail-closed. Existing containment retains
independently readable native facts when only a relationship or completion proof is unavailable;
partial evidence never proves completion or readiness.

Public and Development use identical Provider semantics. Normalization grants no mutation or retry
authority. Agents follow the existing Native Work owner and recovery contract: authorized iteration
before synchronization is distinct from recovery after failed synchronization. Public reporting
explains actual work, synchronization limits and resumption; development inspection may expose raw
forms and normalization or failure evidence. Neither asks public users to maintain a compatibility
matrix, changes Matt Skills, or adds telemetry or automatic repair.

Provider edge cases are proven at the existing capture and reconciliation seams, with the shared
Local/GitHub semantic oracle used only for shared semantics. A complete Agent Live Matrix is separate
workflow evidence; it does not prove arbitrary Markdown variants or rewrite historical failures.

## Evidence and proof index

Local native evidence retains the original `status` and `blocked-by` raw facets. Its optional
`normalizations` array identifies only these two rules: `wayfinder-open-status` and
`no-blockers-terminal-period`. These are evidence labels, not new lifecycle states or a general
conformance classifier. A Map-only read recomputes lifecycle evidence: a newly conflicting route
withdraws the open-status label while preserving independently valid blocker normalization.

The following index maps the bounded compatibility rules to executable proof. Test names identify
assertions, not a claim that a particular delivery's verification has already passed.

| Boundary | Proof |
| --- | --- |
| Conflict-free `open`; canonical omission; claimant, Answer (including an empty Answer section), decision and out-of-scope conflicts | `tests/local-markdown-provider.test.ts`: `normalizes conflict-free Wayfinder open…`, `captures a Status-absent Wayfinder…`, and `rejects Wayfinder…in both read paths` |
| Exact one-period sentinel; canonical sentinel and historical omission; deduplicated numeric identity and stale optional titles | Same suite: `both acquisition paths normalize only the allowlisted blocker punctuation` and `Delivery blocker normalization is replaced by current source evidence` |
| Near misses, missing/non-ticket referents, duplicate numeric identity, duplicate recognized fields | Same suite: `both acquisition paths reject blocker near misses…`, `duplicate numeric references…`, and `duplicate…does not certify normalization…` |
| Combined normalization, schema round-trip and unknown-rule rejection; Map-only retention and selective retraction | Same suite: `combined normalizations survive schema round-trip…`, `a Map conflict retracts only lifecycle normalization…`, and `a Map-only…retracts prior open normalization…` |
| Plain/bold/bold-inline and adjacent fields; prose/examples/quotes remain narrative; typed structural ambiguity | `tests/markdown-document.test.ts`: structural field and ambiguity tests; Local suite: `accepts adjacent provider field lines…`, `does not treat prose, examples, or quotes as provider fields`, and `fails closed for mapping, decode, identity and relation gaps…` |
| Map fog and Spec heading aliases; independent empty/unavailable/unsupported semantic roles | `tests/provider-native-subject-contract.test.ts`: `provider semantic roles survive compatible headings…`; `tests/matt-semantic-equivalence.test.ts`: availability and content-consistency tests |
| Parent/route add/remove, deleted subjects, unaffected trusted facts, no stale affected relation, concurrent mutation and membership changes | Existing Local suite: required Map/Spec deletion, replacement decision, ambiguous Map row, concurrent mutation and issue-membership tests |
| Partial evidence cannot establish a ready baseline or completion; failed attempts remain distinct | Local suite: `a repaired subject cannot turn a partial full capture into a ready reconciliation basis`; `tests/provider-reconciliation-basis.test.ts`; `tests/native-work-provider.test.ts`: `keeps state, freshness and completion independent while forbidding false completion` |
| Provider-neutral semantics, separately checked native identity and evidence | `tests/matt-semantic-equivalence.test.ts`: canonical and compatible Local reference scenarios through the same Local/GitHub oracle, plus `preserves provider-native identity and evidence without requiring serialized equality` |

The Local `observeReferenceChange` helper starts from a current, complete full capture, compares
targeted reconciliation with a new full capture, and checks native bytes and modes remain unchanged.
Its `localSemanticView` compares state, coverage, completion, projected objects (including raw facets
and normalization), semantic availability, direct relations, and diagnostic code/class/impact/target.
It excludes observation identity, acquisition time, read counts, reconciliation-basis evidence and
display timestamps. Native file reads are asserted separately where their boundedness matters.

This refinement adds no new validators for historical canonical `claimed`/`resolved` Wayfinder
behavior, including the existing resolved/out-of-scope fixture without an Answer. Writer obligations
remain owned by the tracker contract; tests and observed Agent output cannot broaden that contract.
Pinned Live fixtures stay canonical. Repository verification and a fresh complete Live Matrix on the
final exact package remain separate delivery checks, not substitutes for these deterministic tests.

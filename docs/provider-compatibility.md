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

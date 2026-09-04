# Repository Update

## Applicability

Use only when the requested functional operation returns `repository-update-required` together
with this installed Kit's complete target contract and this guide. Source package version is
provenance and a newer-state safety boundary; it is never a migration dispatch key. The Agent must
establish that the actual older repository meaning maps to the target without loss, ambiguity, or
expanded authority. Otherwise stop unchanged as Invalid or Unsupported.

## Authority

The Human authorizes one complete visible Repository Update candidate. The Agent owns semantic
interpretation and the single target-manifest write. Deterministic Modules own lifecycle identity,
target validation, exact effect verification, and the disposable Project Read Model rebuild.

Repository Update and Global Kit maintenance have separate owners and write scopes. A
`repository-update-required` result supplies current target facts; it does not authorize or provide
evidence for Global Kit maintenance. Repository Update has no authority to mutate provider-owned
native work.

## Target contract

- **Required target fields:** `schemaVersion`, `packageVersion`, `status`, `runtime`, `surfaces`, and
  `executorProfiles`. Use the exact target manifest values returned by current lifecycle inspection.
- **Semantic invariants:** Preserve lifecycle status, selected surfaces, and executor profiles.
  Preserve canonical Bearing State, Provider Configuration, Execution Profiles, and managed
  instruction content byte-for-byte. Provider-owned native work receives zero writes.
- **Bounded write domains:** The only canonical repository write is `.bearing/manifest.json`. For
  an Active target, the only other allowed write is the runtime-selected disposable Project Read
  Model named by the target contract. A Deactivated target has no disposable write domain.
- **Validation:** Validate the complete target manifest and every preserved invariant. For an
  Active target, rebuild the disposable Project Read Model with zero provider acquisition, then
  validate lifecycle and diagnostics before retrying the original functional operation. For a
  Deactivated target, validate the target and Deactivated lifecycle. A deactivated target creates
  no active Project Read Model.

The contract contains no old-version-to-new-version routes. A safely decoded older Active or
Deactivated schema-1 manifest is eligible only when its canonical SemVer is older than the
installed target and all of its actual semantics can be preserved. Missing Stable runtime meaning
maps to explicit `stable`; explicit `development` remains `development`. Do not silently convert
runtime meaning.

## Operation

1. Read the lifecycle target contract and the actual repository meaning. Separate established
   facts from ambiguity. Verify every required field, semantic invariant, bounded write domain, and
   validation step. Do not select behavior from the source version. Completion: the mapping is
   complete and lossless, or the repository remains unchanged.
2. Show one concise candidate in the Human's language. State the target effect, preserved meaning,
   and the lifecycle-appropriate next action. Do not show checksum dumps, the full manifest,
   internal checklists, or a recovery tree. Obtain one Human confirmation before any write. If the
   Human declines, all repository bytes remain unchanged. Completion: the
   complete bounded candidate is accepted or the repository remains unchanged.
3. Immediately before writing, re-read every exact source byte and path precondition used by the
   candidate. A material source change invalidates the acceptance: perform no write until the Agent
   re-evaluates the current facts, presents the changed candidate, and obtains confirmation again.
   A new write scope is a different mutation and requires separate authority. Write only the exact
   target manifest. Completion: exact effect verification proves that one canonical write and every
   byte-preservation invariant, or stop at one actionable blocker.
4. Validate the target manifest. For an Active target, run `bearing cache rebuild --repo
   <repo-root>` once. Reuse only validated typed provider evidence and preserve its freshness and
   failure meaning. Never acquire provider data or copy, edit, or migrate raw SQLite rows. For a
   Deactivated target, validate the Deactivated lifecycle without running cache rebuild; later
   Reactivation remains a separate Repository Configuration candidate and confirmation. Inspect the
   resulting lifecycle in both cases; run `bearing inspect diagnostics --repo <repo-root>` only for
   an Active target. Normal retry and scoped repair within the accepted bounded write set proceed
   without another confirmation. If an external blocker stops the disposable rebuild after the
   target write succeeds, the target manifest remains valid; report one exact resumption point
   instead of downgrading it or exposing a recovery tree.
5. For an Active target, retry the original functional operation from current typed facts and
   return that operation's outcome. For a Deactivated target, return the validated Deactivated
   outcome without implicitly Reactivating or running an Active-only operation. Do not replace the
   truthful outcome with a Repository Update receipt.

## After this operation

- **Required:** A newer repository remains unchanged and routes to separately authorized Global Kit
  Update.
- **Required:** Corrupt, unreadable, unsafe, semantically ambiguous, or authority-expanding state
  remains unchanged as Invalid or Unsupported. Report the exact reason, state explicitly that no
  repository bytes were written, and give one case-specific next step owned by the relevant Human
  or platform boundary. A different repair mutation requires separate authority.
- **Do not infer:** Package version, successful rebuild, diagnostics, or the retried operation alone
  proves planning acceptance, Effort conclusion, Gate passage, or Roadmap completion.

## Completion criterion

One accepted target-driven candidate produced only the bounded target writes, validation completed
without provider acquisition, and the original functional operation returned its own truthful
outcome.

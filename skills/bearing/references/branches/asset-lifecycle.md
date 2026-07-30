# Bearing Asset Lifecycle

Own an explicit registry disposition for one precisely identified Asset. This internal branch continues from established public orientation and never re-enters the public router.

## Process

1. **Orient to the Asset.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`. Read the Asset Registry entry, its current disposition, replacement when proposed, owner, Producer provenance, Citations, Authority adoptions, Gate Passage Evidence uses, dependent references, and diagnostics. Registration of a missing Asset is an Artifact Registration prerequisite rather than an implicit part of this branch. Completion: one registered Asset and every affected reference are explicit.
2. **Choose one disposition event.** Transition an `available` registry-owned Asset to `superseded` with exactly one registered replacement, or to `archived` without a replacement. Supersession records `Superseded at`; archive records `Archived at`. The two events are mutually exclusive, existing lifecycle events are immutable, and native-owned lifecycle remains outside this branch. Completion: the requested transition has exactly one valid next state.
3. **Obtain explicit user acceptance.** Present the Asset identity, disposition, replacement when applicable, rationale, affected references, consequences, and exact write set. Filesystem absence, producer output, registration, Citation removal, Authority baseline changes, Gate Passage, Sync, or provider state never authorizes a disposition. Completion: the user has explicitly accepted this exact transition or the outcome is `awaiting-decision`.
4. **Build the atomic virtual result.** Re-read all decision inputs. Generate current UTC Source Event Time inside this owning operation and include it with the disposition in the same atomic canonical mutation. Historical missing time remains `Time unavailable`; chat time, file metadata, Git history, Provider Observation Time, Projection Time, Sync completion, or later prose never backfills it. Validate registry shape, lifecycle source, replacement availability, reference integrity, and the complete virtual Registry before writing. Completion: exact candidate bytes validate against unchanged inputs.
5. **Apply and verify.** Atomically write only the Asset Registry and roll it back on any write, validation, or protected Sync failure. Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` and inspect the affected Asset, replacement relation, Citations, Authority adoptions, Gate Passage Evidence uses, and diagnostics. Completion: the accepted disposition and its event time agree across canonical state and the typed read model.

## Read Set

- Established public orientation, including manifest, Project Summary, and Project Sitemap; do not reload it
- `.bearing/state/assets.md`
- The target Asset, proposed replacement, owner, Producer provenance, and dependent references
- Relevant Authorities, Citations, Gates, diagnostics, Checks, and Reviews

## Write Set

- `.bearing/state/assets.md`
- Disposable sync outputs

Never mutate a Roadmap, Gate, Gate Passage, Effort, Work Binding, Authority, Citation, Accepted Decision, provider-native artifact, or native lifecycle under Asset lifecycle ownership.

## Outcomes

- `applied`: the explicitly accepted registry disposition and its UTC Source Event Time validate atomically.
- `no-op`: the Asset already has the exact accepted disposition and no new lifecycle event is created.
- `awaiting-decision`: disposition, replacement, rationale, or affected-reference treatment is not explicitly accepted.
- `blocked`: the Asset, lifecycle owner, replacement, references, diagnostics, or virtual Registry cannot be trusted.

## Recovery

Changed inputs invalidate the candidate. Restore the exact prior Asset Registry bytes on any failure. Never repair an uncertain disposition by inferring it from filesystem state, producer output, registration, provider state, or Sync.

## Completion Criterion

One registered Asset has one explicitly accepted registry-owned supersession or archive event, current UTC time came from the same successful atomic canonical mutation, dependent truth remains unchanged, and refreshed typed inspection agrees with the Asset Registry.

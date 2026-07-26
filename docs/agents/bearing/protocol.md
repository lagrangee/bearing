# Bearing Protocol

This package-owned protocol defines the shared domain law for Bearing. Specialized skills own their complete operating procedures. Consumer repositories store neither this file nor skill copies.

## Role

Bearing is the Project Governance layer for long-running agent collaboration. It keeps accepted direction, decision boundaries, governing context, durable artifacts, and whole-project alignment visible without becoming a second issue tracker or executor.

A repository is Bearing-enabled only when `.bearing/manifest.json` exists. Its root Agent Surface instruction loads the global `bearing` skill for every project request. The global package remains the source of protocol and skill behavior.

## Capability Layers

- **Project Governance:** Bearing owns Roadmaps, Milestone Gates, Effort bindings, Authorities, the Asset Registry, Alignment Checks, Planning Reviews, Project Summary, semantic advisory snapshots, and the Project Sitemap.
- **Work Management:** the configured adapter owns Maps, Tickets, tasks, dependencies, claims, blockers, work status, and resolution. The MVP adapter is Matt-native local Markdown.
- **Execution:** the selected executor owns implementation, verification, and native evidence. Executor Profiles explain writeback; they do not select an executor.

Classify a tool by the capability it is exercising, not by brand. One toolkit may span layers. Preserve the owning layer's native contract whenever capabilities are composed.

## Storage And Truth

- `.bearing/manifest.json` is the enablement marker and current package metadata.
- `.bearing/state/` contains canonical Bearing truth.
- `.bearing/cache/` contains disposable projections and diagnostics. Deleting it loses no accepted project truth.
- `.bearing/executor-profiles/` contains project-owned, user-customizable writeback contracts.
- `$HOME/.bearing/catalog.json` contains user-level discovery and operational metadata for explicitly registered repositories; its backup, lock, temporary files, and `$HOME/.bearing/entry-leases/` operation locks are not repository planning truth. Entry lock filenames use the canonical lowercase reversible encoding of the validated Entry ID, not the Entry ID text itself.
- `.scratch/<slug>/effort.md` is the only Bearing sidecar inside a Matt-native work scope.
- Matt-native `map.md`, `PRD.md`, `issues/`, status, blockers, claims, resolution, `CONTEXT.md`, and `docs/adr/` remain native artifacts.

Bearing Web is read-oriented. It may consume or rebuild `.bearing/cache/`; canonical mutations happen through Agent Surface capabilities.

## Orientation And Composition

The global `bearing` skill is a stateless governing runbook. For the current request it combines the latest prompt, recent conversation, optional Project Summary, complete Project Sitemap, and materially relevant canonical sources. It then continues ordinary work, composes another capability, or delegates a governance mutation to its owner.

Before composing a Work Management or Execution capability, supply relevant Roadmap, Gate, Authority, Asset, open-conflict, and Effort context. Preserve the capability's native lifecycle. Afterward, reconcile by ownership: native status, blocker, dependency, claim, and resolution changes remain Work Management writes and require only centralized sync; factual durable outputs use the Artifact Registration Route; only a candidate Effort binding, Authority baseline, active Asset disposition, citation, or planning-intent change routes to its owning `bearing-*` capability.

Relevance is context, not adoption. Reading an Asset or Authority does not bind work, accept a decision, or change planning truth.

Capabilities may be user-invoked or composed by `bearing` only for a current user request. A user-configured external automation run is a current user-authorized request; Bearing does not schedule or self-trigger it. Capabilities do not run as background autonomy. In an uninitialized repository, any Bearing capability routes through `bearing-setup`, then resumes the original request after accepted setup.

## Project Governance Objects

- **Project Summary:** optional accepted one-page synthesis with Purpose, Current Design, Boundaries, Future Candidates, and Material Revisions.
- **Roadmap:** a lightweight, independently governed rolling outcome horizon. Roadmaps are peers, not a nesting tree. One active Roadmap may focus one Gate.
- **Milestone Gate:** a lightweight decision boundary. Readiness is derived from contributing work; passage is an explicit human decision.
- **Effort:** the sole bridge from one native work scope to one Roadmap and one Target Gate. It has no canonical Status.
- **Authority:** a scoped current accepted baseline, initially `product-design` or `architecture`. It extends rather than replaces project context and ADRs.
- **Asset:** globally visible metadata for a durable artifact with one primary owner and producer provenance. Content stays at its native or project location.
- **Planning Citation:** an explicit Asset reference on a permitted Bearing object, with one concise Note explaining relevance.
- **Item Alignment Check:** a durable target-scoped material conflict or drift decision point.
- **Planning Review:** a durable project-wide material question and accepted outcome.
- **Planning Audit:** one replaceable current semantic whole-project snapshot.
- **Next Work Guidance:** one replaceable current recommendation with a primary direction and zero to two meaningful alternatives. Every item has an explicit H3 plain-text title, plain-text rationale, and an H4 Supporting References list of stable Bearing IDs or repository-relative locators; consumers never infer those fields from prose.
- **Project Sitemap:** a deterministic materialized projection for orientation and retrieval, never canonical truth.

Fog, readiness, counts, diagnostics, Attention, and derived Effort state are annotations, not canonical objects.

## Identity And References

Bearing Stable IDs use `roadmap:`, `gate:`, `effort:`, `authority:`, `asset:`, `alignment-check:`, and `planning-review:`. Current snapshots use `project-summary:current`, `planning-audit:current`, and `next-work-guidance:current`.

Canonical Bearing references use Stable IDs. Matt-native Maps and Tickets keep opaque Tracker References, represented as repo-relative POSIX paths by the local adapter. Markdown links are navigation only.

Asset `Location` values are repo-relative POSIX paths or producer-owned external locators. Producer `Reference` is opaque to Bearing.

## Normalized Semantic Text

Every human-readable value that enters the normalized Project Snapshot must be non-blank plain UTF-8 text. This includes Titles, Intent, Scope, Project Summary prose and list items, Guidance titles and rationales, Citation Notes, accepted decisions, rationales, exceptions, Asset and Producer labels, Audit Finding prose, and generated diagnostic or projection-issue messages. Do not author Markdown or HTML links, code spans, emphasis, block quotes, code blocks, comments, headings, lists, or other formatting syntax inside these semantic values.

Authors write clean semantic text at the source. Projection validates it without stripping, rendering, parsing Markdown, or guessing intent; invalid text isolates the smallest owning projection, while the original source remains available through its source affordance. Generated human messages use stable plain copy rather than echoing untrusted source scalars. Native Work Management keeps its own authoring contract, and the adapter isolates a native title that cannot enter this read model.

Stable IDs, Tracker References, repository paths and locators, timestamps, fingerprints, enum or lifecycle values, Producer References, and the required backtick-list syntax under Guidance Supporting References are structural values, not semantic prose. Do not apply the semantic-text rule to them.

## Accepted Decision Boundary

Require an Accepted Decision when a mutation asserts what the project should now pursue, sequence, depend on, be governed by, stop relying on, or regard as passed.

This includes material Roadmap, Gate, Effort binding, Authority baseline, active Asset disposition, Project Summary design/boundary, Alignment Check resolution, and Planning Review outcome changes. Present intent, reason, and material consequences before acceptance. A concrete user instruction that already states target and intent may constitute acceptance; do not ask twice.

Artifact production, factual registration, provenance correction, Planning Citation, deterministic projection, diagnostics, findings, and recommendations are not Accepted Decisions. They cannot silently cause a decision-bearing mutation.

## Mutation Ownership

- `bearing-setup` exclusively owns repository enablement, reconciliation, deactivation, and purge, plus orchestration of explicit Project Catalog rename, forget, relink, repair, and reset operations.
- `bearing-summary` exclusively owns Project Summary creation and revision.
- `bearing-roadmap` owns Roadmap intent, lifecycle, Gate order, and focus. While creating or extending a horizon, it may atomically create new planned Gates whose complete initial contract is part of the same Accepted Decision; it never revises an existing Gate.
- `bearing-milestone-gate` owns standalone Gate creation plus every existing Gate's intent, exit criteria, lifecycle, passage, split, and supersession; its accepted transaction owns the coupled Roadmap order or focus transition required by that Gate operation.
- `bearing-alignment-check` owns target-scoped Effort binding changes, Authority changes, active Asset disposition decisions, and accepted scoped resolutions.
- `bearing-planning-review` owns accepted project-wide cross-object resolutions that do not invade Summary-, Roadmap-, or Gate-exclusive fields.
- `bearing-planning-audit` owns the current Audit snapshot and promotion or refresh of unresolved Checks and Reviews.
- `bearing-next-work` owns the current Guidance snapshot.
- The protocol-owned **Artifact Registration Route** owns factual registration of a newly produced durable artifact. Its Execution Writeback branch reads the Executor Profile actually used, preserves native evidence, writes a fallback receipt only when required by that profile, appends factual Asset metadata and provenance, links native resolution when its owner permits, and runs sync. It cannot create Planning Citations, adopt an Authority baseline, choose an active Asset disposition, bind an Effort, or change planning intent.

Effort bootstrap may create a previously absent sidecar during a native planning flow only after the user accepts its Roadmap and Gate binding. Roadmap or Gate operations that require an Effort binding disposition first return that prerequisite to `bearing-alignment-check`; they do not write the sidecar. Native work lifecycle remains owned by the Work Management capability.

No catch-all writer exists. A coordinator that needs another owner's mutation returns the required capability instead of performing or silently invoking it.

## Planning Transaction

Every canonical mutation follows:

`Inspect -> Propose -> Accept when required -> Re-read -> Apply -> Validate -> Sync`

1. Inspect decision-relevant inputs, references, diagnostics, and the complete intended write set.
2. Propose the semantic diff, reason, consequences, and exact write set.
3. Obtain acceptance for decision-bearing or destructive changes.
4. Re-read immediately before writing. Changed inputs invalidate the proposal; recompute rather than silently merge.
5. Retain original bytes, stage and validate the complete virtual graph, then apply only the owned write set.
6. Validate schemas, IDs, references, lifecycle invariants, and required narrative sections.
7. Run `$HOME/.bearing/bin/bearing sync --repo <repo-root>` as the centralized write-through updater.

On partial failure, restore original bytes and remove only transaction-created targets. Return `blocked` with attempted, restored, and current target states. Partial canonical success is never a successful outcome.

## Project Catalog Operations

The Project Catalog persists only `entryId`, canonical `repoRoot`, and user-local `displayName`. Setup or reconcile performs an idempotent upsert after the repository manifest validates. Successful deactivation or purge removes the entry by its pre-mutation canonical root. Repository and Catalog transactions report separate outcomes: a later Catalog failure never rolls back a committed repository lifecycle mutation, and the overall operation remains blocked until an idempotent retry heals the split outcome.

Catalog mutation is available only through `bearing catalog` primitives orchestrated by `bearing-setup`: `rename --entry <id> --name <alias>`, `forget --entry <id>`, `remove --repo <root>` for lifecycle writeback, `relink --entry <id> --repo <root> [--confirm-move]`, `repair`, `repair-lock --confirm-abandoned`, `repair-entry-lock --entry <id> --confirm-abandoned`, and `reset --confirm-empty`. Relink validates the target and preserves identity; when the old repository is still available, `--confirm-move` records the explicit move-versus-copy choice but moves no files. Backup repair is allowed only from a trustworthy backup. Lock repair is a separate abandoned-lock operation and never changes Catalog documents. Reset is allowed only when current and backup are unusable, discards all registrations, and never scans for replacements. Forget and every recovery operation mutate no repository.

Every ordinary Catalog mutation takes the bounded user-level lock, re-reads and validates the complete current document, validates the complete next document, retains one last-known-good backup, and atomically replaces the current file. A malformed current document with a valid backup is read in explicit degraded mode and blocks ordinary mutations until backup repair. An unusable current and backup block every operation except confirmed reset. Lock ownership may be reclaimed automatically only when one bounded, single-link regular owner record proves its process absent. A missing, malformed, linked, or unsupported owner is indeterminate and blocks without following or waiting on its bytes.

One Portal project operation holds `$HOME/.bearing/entry-leases/<encoded-entry-id>.lock` across its complete write-capable execution. It briefly takes the global Catalog lock, attempts the entry lock with zero wait, and revalidates strict `entryId` to `repoRoot` ownership while both are held. If that entry is busy, it releases the global lock before bounded retry; after admission succeeds, it releases the global lock and retains only the entry lock for project work. Catalog transactions parse the complete next document and, before writing any Catalog bytes, take zero-timeout entry guards in stable ID order only for identities whose repository ownership changes. Consequently, rename and unrelated-entry mutations remain independent while relink, forget, removal, or replacement of an in-use entry fail closed. Backup repair and reset hold the global lock while inspecting the exact lease namespace, so no new operation lease can enter between inspection and the guarded Catalog write; active, indeterminate, or unsafe entry locks are refused.

Confirmed lock repair is the sole exception to taking the lock it repairs. It revalidates the exact lock generation, recovery claim, owner, staged-owner, and self-describing initializing or quarantine identities before removal; refuses a valid live or process-indeterminate owner; follows no links; and performs no recursive deletion. An initializing generation publishes a compact PID and random token in its basename before any owner-file write, so repair may remove a pre-owner initializer only when that PID is proven absent. Legacy pre-owner initializers without PID evidence remain indeterminate. Repair may unlink only exact captured non-directory entries, may remove exact empty directories, and refuses unknown names, nonempty unknown directories, or any replacement race. A missing canonical lock with no matching transient generation is a no-op.

Entry-lock repair requires one validated Catalog Entry ID and the separately confirmed `repair-entry-lock` command. It derives the canonical encoded filename, enumerates only the fixed entry-lease parent to identify strictly named transient generations for that canonical prefix, and never targets another entry or an unknown sibling. It follows no links, changes no Catalog document, and applies the same live-owner, indeterminate-owner, exact-generation, and replacement-race refusals as global lock repair.

## Matt-Native Adapter

One `.scratch/<slug>/` is one native work scope. It may contain `PRD.md`, zero or one `map.md`, and `issues/`. The optional `effort.md` binds that scope to Bearing.

A Map is context and a decision index. Each unresolved bullet under `## Not yet specified` projects one Fog annotation. Tickets retain native lifecycle:

- `open` with all blockers resolved projects Ready.
- `open` with any unresolved blocker projects Blocked.
- `claimed` projects Claimed.
- `resolved` projects Resolved.
- Matt triage statuses remain native request states outside those lanes.

An Effort may have Tickets without a Map. Fog and Tickets may coexist. Bearing does not infer Fog-to-Ticket coverage from text similarity.

## Readiness And Horizon

Gate Readiness is `unknown | not-ready | ready-for-review`. It is `unknown` when structure or lifecycle is untrustworthy or no classified work contributes; `not-ready` when any contributing Map, Fog, or work remains nonterminal; `ready-for-review` only when every contributing native item is trustworthy and terminal.

Readiness never proves Exit Criteria or passes a Gate. Gate passage records the Accepted decision, Rationale, Evidence Asset IDs, and explicit Exceptions. Passing the focused Gate advances focus to the next ordered Gate or clears focus when the horizon is exhausted.

Roadmap Horizon is `active-horizon | exhausted | unknown`. Exhaustion recommends a Roadmap decision; it does not complete the Roadmap automatically.

## Authorities, Assets, And Evidence

An Effort declares every Authority that materially governs it and reads those current baselines before material recommendations or execution. A conflicting baseline may be challenged through alignment; it is not bypassed or mutated silently.

Artifact production, Asset registration, Planning Citation, and Authority adoption are separate actions. Registration does not imply citation or adoption. `citation-count = 0` is a useful derived signal, not a structural error.

Preserve executor-native artifact and evidence locations. When none exists, use scope-local `mocks/`, `prototypes/`, or `evidence/` as needed. Register durable outputs before resolving managed work.

Register an executor output when it is required durable evidence or a repository artifact meant to survive the execution session, such as a spec, mock, prototype, source artifact, verification report, or profile-required receipt. Do not register transient logs, chat summaries, scratch commands, or recoverable executor internals. A bound output uses its Effort ID as `Owner`; an unbound native output uses the producing Map or Ticket Tracker Reference. Unbound registration never invents an Effort.

Execution-produced Assets use `Producer.Kind: executor-profile`, the actual profile key as `Producer.Name`, and optional native `Reference`. Execution Evidence also records `Produced for` with the opaque work-item reference. Preserve separate attempts. Never persist thread IDs, model names, preferred executors, or transient commands as provenance.

After the actual executor is known, the host Agent Surface reads `.bearing/executor-profiles/<profile>.md` and applies the Artifact Registration Route before managed native work is resolved. This factual route is not an Alignment Check and requires no material finding. If registration exposes a decision about adoption, disposition, binding, or intent, register only the facts and route that separate candidate to its owning capability.

Registry-managed Assets use `Disposition: available | superseded | archived`; a superseded Asset names its replacement. Authority adoption requires acceptance. Historical Assets remain addressable.

## Diagnostics, Audit, And Attention

Deterministic sync owns Structural Diagnostics. Planning Audit consumes fresh diagnostics and performs semantic analysis; it does not duplicate the scanner.

A Planning Audit body has exactly `# Planning Audit`, then `## Findings`. Zero findings use only `No material findings.`. Otherwise, every H3 plain-text finding has plain summary prose followed in exact order by `Affected References`, `Evidence Sources`, `Consequence`, and `Confidence Boundary` H4 sections. Reference sections use unique backtick-list entries; evidence entries are repository-relative source locators. An optional final `Promotion` section contains exactly one canonical Alignment Check or Planning Review reference. No other H2 or H4 structure, semantic markup, or severity, priority, or risk field belongs in the Audit body. Sync isolates malformed findings when at least one finding remains trustworthy; an entirely malformed body invalidates the Audit.

A target-scoped Material Finding becomes or refreshes an open Alignment Check. A project-wide Material Finding becomes or refreshes a pending Planning Review. Promotion creates a decision point; it does not accept or resolve it.

Attention is the derived union of blocking diagnostics, open Checks, and pending Reviews. It is not a canonical file. Surface relevant Attention without automatically displacing a clearer operational frontier.

When no managed scope exists, Planning Audit returns `no-op: no-managed-scope` and writes no snapshot. When no managed frontier exists, Next Work returns `no-op: no-managed-frontier` and writes no snapshot. These bounded results never imply that the user has no work; continue the original request using ordinary repository and conversation context.

## Project Sitemap And Sync

`.bearing/cache/project-sitemap.md` contains one compact node per Project Summary, Roadmap, Gate, Effort, Authority, Asset, Alignment Check, Planning Review, current Audit, current Guidance, native Map, and native Ticket. Roadmap Index remains the separate canonical catalog. Each node carries Type, Stable ID or Tracker Reference, Title, lifecycle or derived state, primary relations or dependencies, and source locator. Invalid canonical objects retain locator-based `invalid:` shells and do not contribute trusted relations or rollups.

Known canonical or native writes call the centralized sync updater. Manual, periodic, explicit freshness doubt, missing-cache, malformed-cache, or failed-update reconciliation runs full `bearing sync`. The updater detects changed Inputs and rebuilds the projection; callers never hand-edit Sitemap lines.

`bearing` reads the complete Sitemap, then uses semantic judgment over the latest prompt and recent conversation to select canonical sources. The source object wins every conflict with the projection.

## Invalid State

Parse artifacts independently. A malformed object isolates the smallest affected scope rather than blanking the project. Blocking diagnostics include malformed schemas, unsupported lifecycle, duplicate IDs, broken required references, and unrecognized adapter status. Non-blocking diagnostics preserve trustworthy projection.

Valid absence includes an unbound native scope, Effort without Map, Fog beside Tickets, zero citations, empty Authority baseline, and missing advisory snapshots. Sync reports these states without inventing defaults or repairing canonical files.

## Hard Boundaries

- Treat the MVP as a local trusted-checkout tool, not a filesystem security sandbox. Setup and sync reject unsafe links and target shapes observed at validation time; they do not claim safety against concurrent hostile filesystem mutation.
- Preserve native Map, Ticket, claim, blocker, and resolution contracts.
- Keep Project Sitemap and diagnostics disposable.
- Keep canonical mutation in Agent Surface owning capabilities.
- Keep Bearing Web out of `.scratch` and `.bearing/state` writes.
- Keep setup out of Git staging, commits, and `.gitignore` policy.
- Keep package uninstall in the package manager.
- Keep scheduler, hooks, alternate adapters, compatibility migrations, and automatic Authority discovery outside the MVP.

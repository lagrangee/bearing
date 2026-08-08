# Bearing Repository Configuration

Own the Agent-led Repository Configuration conversation. This branch continues from Established public orientation; do not reload or re-enter the public router. It uses the package-owned typed Inspect, Plan, and Apply operations. It never installs the global kit, writes canonical planning, mutates Matt-native work, or performs platform removal.

## Process

1. **Inspect typed facts.** Read `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`, then run `bearing configure inspect --repo <repository-root>`. Report detected facts: lifecycle, current selections, installed capability evidence, path safety, and Catalog availability. Invalid or Unsupported is removal-required: stop and request a separate, explicit, Agent-reviewed platform removal. Do not run a compatibility migration, cutover, recovery parser, purge command, or cleanup guess. Completion: every fact comes from the typed inspection.
2. **Resolve one material decision at a time.** The running Agent Surface is the primary fact. A matching instruction file needs no redundant question. When neither `AGENTS.md` nor `CLAUDE.md` exists, ask whether to create one or both. Resolve the one `matt-skills/v1` Provider Configuration and the executor decision. Bearing never stores or asks for a tracker driver. The executor decision begins unresolved and only an explicit nomination or explicit skip or none decision resolves it. A missing Matt prerequisite belongs to its owning capability; after an accepted handoff completes, re-inspect and resume. Refusal produces no Bearing repository writes. Completion: no inspectable fact became a question.

Before the final Apply review, ask exactly once in ordinary user language whether to nominate an executor or skip. Skip does not block Repository Configuration completion. Agent Surface selection, Matt prerequisite consent, provider validation, and Apply acceptance never imply executor skip.
An assisted prerequisite handoff resumes the same visible Fresh continuation and preserves the executor decision. The prerequisite owner's consent does not substitute for the final Repository Configuration Apply review. When the handoff resumes and the executor decision resolves, present the complete owner-separated review; never compress it to an Apply confirmation. Repeat the exact Repository Apply Unit, preserved content, and independent Catalog effect.
3. **Assess only an explicit executor nomination.** Never scan, rank, recommend, install, whitelist-match, prefer, or select a default executor. Read the nominated `SKILL.md` and its directly required local execution-contract references. Make an explicit semantic assessment for end-to-end execution and final outcome or writeback. Do not infer eligibility from keywords. Record exact directly required local reference locators and exact source excerpts for ownership and writeback. Planning, testing, TDD, debugging, and review helpers remain supporting skills. An unavailable, malformed, ambiguous, invalid, or supporting-only nomination is explained once; without materially new contract evidence, ask only for a different nomination or skip. Completion: each accepted surface-scoped profile has source-supported semantics.

Each accepted surface-scoped profile has a portable surface-qualified capability locator. The package-owned Generic evidence-reconciliation fallback remains hidden during Repository Configuration and is used only when later writeback matches no specialized registration. Multiple registrations coexist without cross-surface deduplication, priority, preference, or default semantics.
4. **Seal the exact Plan.** Run `bearing configure plan --intent <activate|deactivate> --repo <repository-root>` with the complete resolved configuration. Repeat `--surface`, `--executor`, `--executor-assessment`, `--retain-executor`, and `--remove-executor` only for accepted choices. The typed Plan must include every write and removal target, its precondition, preservation effects, the independent Catalog stage, and one `sealedPlanToken`. For Deactivation, preserve State, Provider Configuration, Execution Profiles, durable artifacts, and native work. Completion: one final owner-separated Apply review shows the exact Repository Apply Unit and later Catalog effect.
5. **Accept once, then Apply the sealed Plan.** Ask for one explicit Apply acceptance after all choices are known. The prerequisite owner's acceptance does not substitute for this final review. Repeat the exact configuration with `bearing configure apply --intent <activate|deactivate> --plan-token <reviewed-token> --repo <repository-root>`. The deterministic CLI receives only resolved configuration. It performs no free-prose intent inference, accepts no no-executors marker, and creates no proof that the question was shown. A stale token or changed precondition writes nothing. Completion: the returned plan identity and reviewed token match.
6. **Validate split outcomes.** Repository validation commits before the Catalog independent outcome. A Catalog failure must return `partial` with separate `Repository` and `Catalog` outcomes plus typed `pendingStage` and `nextAction`; it never rolls back or relabels the valid Repository Apply. Resume by running current Configure Plan and Apply again with the same accepted desired configuration. A successful retry may be a repository no-op while it completes the Catalog stage. Completion: both owner outcomes and any exact resumption are explicit.
7. **Finish the Portal handoff.** After successful Fresh activation or reactivation, probe only the configured loopback origin: `BEARING_PORT` when present, otherwise `http://127.0.0.1:4178`. Never scan other ports and never start Portal automatically. Probe `/healthz`. A connection failure is `absent`; tell the user to run `bearing portal` in a separate terminal. A reachable Host with an invalid response, incompatible Bearing package and read-model, or unreadable current Catalog Entry is `incompatible`; tell the user to stop it and start Portal from the current kit. A compatible Host returns `/projects/<catalog-entry-id>`. Portal never changes Repository Configuration success for Fresh activation, and a routine Active no-op does not repeat a start recommendation. Completion: exactly one typed handoff branch is reported when applicable.

8. **Preserve planning boundaries and resume.** Repository Configuration created no Roadmap, Milestone Gate, Effort, Work Binding, substantive Project Summary, Project Brief, or Matt-owned mutation. For an applied Fresh outcome, complete repository validation, Catalog result, and exactly one Portal handoff before the Project Orientation offer in the current user's language. Explain that Orientation reads project files and existing tasks and progress, produces analysis, a Project Summary draft, and possible Roadmap and Gate candidates, and does not automatically modify files, tasks, or planning. Present accept and skip together; Configuration is already complete and skip changes nothing. Acceptance enters shared `project-orientation` in the same visible conversation. A decline does not acquire inventory and writes no Summary, Brief, planning, or native mutation. Completion: the original request resumes unchanged.

Fresh initialization may offer Project Summary drafting only through accepted Project Orientation; Repository Configuration does not create Project Brief. An explicitly requested Active-project Scope Review remains a separate non-mutating owner path.
Repository Configuration does not create or refresh a substantive Project Summary. When Orientation evidence is insufficient, Summary and Brief honestly remain absent.
Repository Configuration never inspects native scope outside an accepted Project Orientation or explicitly requested Active-project Scope Review.
`partial`, `blocked`, or `cancelled`, independent Catalog recovery, Active reconcile or no-op, and reactivation never trigger the Fresh Project Orientation offer. There is no offer marker, receipt, cache entry, lifecycle field, or persisted eligibility state. An assisted prerequisite, executor correction, or same visible continuation Catalog retry preserves Fresh offer eligibility until completion.

## Read Set

- Established public orientation and the original request; do not re-enter the router
- Typed `bearing configure inspect` output
- `$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md`
- Root `AGENTS.md` and/or `CLAUDE.md`
- The selected Matt provider contract
- Only an explicitly nominated executor contract and its directly required local references
- The sealed typed Plan before Apply

## Write Set

- Repository Apply Unit: manifest, Provider Configuration, accepted Execution Profiles, managed blocks on selected and deselected Agent Surfaces, and Fresh local Project Read Model initialization
- Deactivation: manifest status, registered managed pointer removals, and disposable cache removal
- Post-validation Project Catalog upsert or unregister through its domain API

Never write canonical planning, provider-native work, global installation state, or an unreviewed removal target.

## Outcomes

- `applied`: accepted repository mutation and independent Catalog stage completed.
- `no-op`: repository and Catalog already match.
- `awaiting-decision`: one material configuration choice or final Apply acceptance is missing.
- `partial`: Repository is valid and Catalog is pending with a typed resumption.
- `blocked`: the sealed Plan cannot be applied safely.
- `cancelled`: the user stops before Apply, with no Repository Configuration writes.

## Recovery

Re-run typed Inspect after any failure. Never reuse a stale Plan token. A pre-commit repository failure restores prior bytes and removes transaction-created read-model state; a rollback failure reports the exact residue and does not claim success. A Catalog failure preserves the valid repository outcome and resumes only through a new sealed Plan. Unsupported state never enters this workflow; reviewed platform removal is a separate owner boundary.

## Completion Criterion

Typed Inspect facts, accepted choices, the sealed Plan, repository outcome, Catalog outcome, and Portal handoff are explicit. Every successful target validates. Every pending stage has one typed resumption. Canonical planning and Matt-native work remain unchanged.

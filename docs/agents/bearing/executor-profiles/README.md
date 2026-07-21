# Executor Profiles

Executor profiles are user-visible compatibility contracts for execution writeback. They describe how Bearing-aware agents recognize durable artifacts and evidence from a selected executor without choosing that executor or changing tracker-native lifecycle.

`bearing-setup` installs selected templates into `.bearing/executor-profiles/`. Users may revise an installed profile to match their local harness conventions. Once present, a profile is project-owned configuration: setup must show an explicit diff and obtain user acceptance before revising or replacing it.

When execution writeback is relevant, `/bearing` and the host Agent Surface read the profile named by the actual execution method. The protocol-owned Artifact Registration Route uses it to preserve native artifacts, create a fallback receipt only when needed, and append factual producer provenance. A profile must not define Roadmap, Gate, Effort, Map, Ticket, claim, blocking, or completion semantics.

Setup always proposes `generic-agent`. It maps installed skill `implement` to profile `matt-implement`, `omo:start-work` or `start-work` to `omo-start-work`, `superpowers:executing-plans` to `superpowers-executing-plans`, and `superpowers:subagent-driven-development` to `superpowers-subagent-driven-development`. It may inspect a user-supplied custom executor skill and propose a profile for review.

An Executor owns end-to-end work execution and a final outcome or writeback. Testing, TDD, debugging, review, planning, and other method skills are Supporting Skills; they may participate in execution but do not receive their own Executor Profile or Producer identity.

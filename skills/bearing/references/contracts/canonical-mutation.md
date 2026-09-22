# Canonical Mutation

## Applicability

Use to prepare a canonical Bearing planning candidate or apply an accepted change. Candidate
preparation grants no write authority. Repository Configuration uses its own sealed Plan and Apply
journey instead.

## Authority

The Agent owns semantic meaning, materiality, candidate bytes, acceptance interpretation, direct
editing, accepted event time, and repair of its own attempted write set. Deterministic Modules own
contained reads, current revision facts, schema and reference validation, and atomic Project Read
Model publication. They do not author planning meaning.

Materiality means that accepted project meaning changed or that a current synthesis became
materially misleading. A Summary changes only for accepted new project meaning. A Brief may refresh
when accepted truth materially changes its usefulness for current orientation, but any new meaning
belongs to its actual semantic owner. Ordinary file changes, native completion, and evidence alone
are not material semantic change. Materiality decides whether a selected owner mutates its target;
it does not make the root's required post-transition owner evaluation optional.

## Operation

1. Before drafting the candidate, use `bearing inspect project --repo <repo-root>` or `bearing
   inspect <stable-planning-reference> --repo <repo-root>` to read the complete current target and
   the direct relations needed for the decision. A complete read proves coverage only. Completion:
   every affected owner and current precondition is explicit.
2. Author one complete Agent-authored candidate. Show semantic effect, rationale, relation
   consequences, exact owner write set, and preserved data. Completion: the candidate has no
   unresolved material choice.
3. Interpret acceptance. A clear direct instruction or clear acceptance of the visible complete
   candidate supplies acceptance. Ask again only for ambiguity, a new material conflict, or an
   unentailed collateral effect. Completion: accepted scope is exact or the operation stops.
4. Re-read every mutable input and target precondition immediately before editing. A changed
   precondition invalidates the candidate; do not merge silently. Completion: current revisions
   still support the accepted result.
5. Direct edit only the accepted owner files. Generate any current Source Event Time inside the
   same accepted owner operation. Completion: the exact accepted owner bytes are written and no
   other canonical file changed.
6. Immediately after editing, run `bearing inspect <stable-planning-reference> --repo <repo-root>`
   for every affected planning reference, then run `bearing inspect diagnostics --repo <repo-root>`
   once. The first post-edit inspect validates the complete schema and references and publishes the
   changed Project Read Model generation. All affected-target and diagnostics inspections read back
   that generation. Completion: affected-target inspection agrees with canonical sources in one
   committed generation and diagnostics report zero new structural defect.
7. Evaluate only the `Required`, `Consider`, and `Do not infer` guidance in each affected owner.
   Completion: required consistency effects are complete and recommendations remain recommendations.

## Guardrails

There is no generic semantic Plan or Apply, automatic confirmation, generic refresh, receipt, or
global follow-up table. A partial write is not success: preserve or restore known-good bytes,
repair only the Agent's own attempted write set, revalidate, and report the exact resumption point.
Do not infer acceptance from tests, diagnostics, provider evidence, native lifecycle, or silence.

## Authoring rules

The selected owner's write form is the package-contained contract for its canonical files. Start
with the accepted meaning and create only the records that meaning needs. An empty canonical state
is valid; it does not authorize a sample project, focus, native scope, Binding, or lifecycle event.
These write forms cover Summary, Brief, Roadmap, Gate, Effort, Asset, and Authority, including the
Roadmap index and Asset Registry. Planning Audit and Planning Review have specialized authoring and
Input Fingerprint requirements outside this first-authoring coverage.

- Write one YAML frontmatter envelope at the start of each file, delimited by `---` lines. Preserve
  exact field names, enum values, Stable ID prefixes, and required section headings. Titles and
  authored meaning use the current Human's language. Quote YAML scalar text when punctuation could
  be interpreted as YAML syntax. Optional `Languages` values are BCP 47 tags, not translated keys.
- Stable IDs are unique across the project. After the owner prefix and colon, use lowercase ASCII
  letters or digits separated by single hyphens, such as `effort:save-notes`. Identity comes from
  `ID`; the file path is a locator. For new collection records, use the ID suffix as the filename
  convention. Preserve an existing valid record's identity and locator unless their change is
  itself accepted. Singleton IDs and container paths are fixed by their owner.
- Include every required field and collection. A required empty YAML collection is `[]`, not an
  omitted key, blank value, or prose saying none. Omit optional inapplicable fields. Use `null`
  only where the owner allows it; absence, an empty collection, and null have different meanings.
  New writes use the documented fields even where the decoder tolerates older representations or
  additional historical data. Do not silently migrate those records or add undocumented keys.
- Give each required `##` section exactly once, using its exact unformatted heading. **Plain prose**
  consists of nonempty text paragraphs, without Markdown links, emphasis, code, headings, or lists.
  **Plain list** uses unique, single-line `- Plain text` items: no task checkboxes, numbering, nested
  blocks, or inline Markdown. An empty plain-list section has its heading and no items. **Free
  Markdown** permits authored formatting and lists; it does not replace required section headings.
  Human-facing YAML text fields also contain nonempty plain text.
- Optional planning `Citations` is an array of mappings with exactly `Asset: asset:<id>` and
  `Note: <plain text>`. Each target must exist. Citation belongs to the citing record; it neither
  creates an Asset nor adopts it into an Authority. Effort requires `Citations`, including `[]`.
- Write the full accepted relation closure. A new Roadmap needs index membership; a new Gate needs
  its owning Roadmap's Gate order; each Gate's Effort order exactly covers all current contributors,
  including planned and concluded Efforts. Preserve existing order except for the accepted change.
  An Effort's Roadmap must match the Roadmap of its Target gate.
- Generate a current event's UTC instant ending in `Z` inside the actual accepted owner operation,
  such as `2026-09-01T09:00:00.000Z`. Example instants describe fictional events, not defaults. Retain
  an existing unknown historical time as its supported missing or null form; file metadata,
  observation time, synthesis time, and request start cannot fill that gap. A fresh event never
  copies an example's time or writes null to represent the event just performed.

Complete fenced examples identify their canonical locator on the opening fence. They demonstrate
shape and relationships, not acceptance of their fictional project meaning. Lifecycle alternatives
replace the example at that same locator; they are not simultaneous duplicate records. Use the
post-edit validation in Operation. Planned unbound authoring requires no provider capture.

# Asset Owner

## Applicability

Use for an explicit Asset admission, creation, identity, metadata, owner, source repair, or
lifecycle change.

## Authority

Asset owns its durable planning identity, metadata, current owner, source, and lifecycle. A Planning
Citation is owned by the planning object that uses the Asset. Citation does not mutate Asset
metadata or lifecycle, and Asset metadata does not create Citation.

Admit an Asset only when it has continuing planning value or is a first-class durable project
artifact. File existence, executor production, durability, Ticket evidence, and Gate proof do not
admit an Asset by themselves. Do not run automatic registration or classification.

## Write form

Write entries in `.bearing/state/assets.md`, one container with required `Type: asset-registry`
and `Assets` array. The container has no Stable ID and no required body sections. Each Asset has
its own unique `ID: asset:<slug>` inside the array; there is no per-Asset canonical Markdown file.
An empty registry uses `Assets: []`. Create the registry only when the accepted Asset operation
needs it; first planning does not require Asset registration.

Every entry requires plain-text `Title` and `Purpose`, `Kind`, `Source`, `Owner`, `Added at`, and
`Disposition`. Kinds are exactly `specification`, `prototype`, `design`, `research`, `baseline`,
`reference`, and `runbook`. Optional `Origin` is plain human-facing context, not structured producer
metadata. `Source` is a contained repository-relative POSIX path (no absolute path, colon, dot
segments, backslash, or empty segment) or a safe `https://` URL without credentials. HTTPS syntax
does not prove remote availability. Owner is exactly one existing `project-summary:current`,
`roadmap:<slug>`, `effort:<slug>`, or `authority:<slug>`; it is not a Gate, native subject, or array.

| Disposition | Applicable event and replacement fields |
| --- | --- |
| `active` | Added at; omit Superseded by, Superseded at, and Archived at. |
| `superseded` | Preserve Added at; require Superseded by and Superseded at; omit Archived at. |
| `archived` | Preserve Added at; require Archived at; omit Superseded by and Superseded at. |

`Superseded by` names one distinct active replacement Asset without a replacement cycle. Current
Authority Baseline members must remain active. A concluded Effort may own historical inactive
Assets, but never active ones. Record new accepted event instants in UTC; required historical
event keys may retain null when their time is unavailable. Entries use only these fields;
Location, Producer, Produced for, and Lifecycle source are not current Asset fields.

### Complete registry example

These are three separately accepted Assets with continuing or historical planning value. The
current format is adopted by the separate Authority example. HTTPS sources here remain unverified;
the example performs no fetch and registers no execution or Gate proof.

```markdown .bearing/state/assets.md
---
Type: asset-registry
Assets:
  - ID: asset:note-format
    Title: Note format
    Purpose: Preserve the accepted local note representation for future changes.
    Kind: specification
    Source: https://example.com/note-format-v2
    Owner: project-summary:current
    Added at: 2026-09-01T09:10:00.000Z
    Disposition: active
  - ID: asset:note-format-draft
    Title: Earlier note format
    Purpose: Retain the replaced representation for historical decisions.
    Kind: design
    Source: docs/note-format-draft.md
    Owner: project-summary:current
    Added at: 2026-08-31T09:00:00.000Z
    Disposition: superseded
    Superseded by: asset:note-format
    Superseded at: 2026-09-01T09:10:00.000Z
  - ID: asset:format-research
    Title: Note format research
    Purpose: Preserve the original comparison as historical context.
    Kind: research
    Source: docs/note-format-research.md
    Owner: project-summary:current
    Added at: 2026-08-30T09:00:00.000Z
    Disposition: archived
    Archived at: 2026-09-01T09:10:00.000Z
    Origin: Initial format investigation
---

# Asset Registry
```

### Complete empty container example

This alternative represents confirmed absence after an accepted registry operation. It does not
authorize removing existing entries or Authority membership.

```markdown .bearing/state/assets.md
---
Type: asset-registry
Assets: []
---

# Asset Registry
```

## Operation

1. Inspect the Asset reference, current owner, source facts requested for this decision, lifecycle,
   and direct planning relations. For an exact local source question, use only the bounded Asset
   Detail probe. Do not use Asset lists or Attention to probe sources. Identify one exact Asset and
   every affected owner before making the candidate. For a lifecycle change, establish complete
   coverage of this Asset's Authority Baselines; another planning object's direct Authorities do
   not enumerate every adopter. Unknown, unavailable, partial, or at-least coverage is unresolved.
2. For admission, state the continuing planning value or first-class artifact purpose. Author only
   `ID`, `Title`, `Purpose`, closed `Kind`, contained local or safe HTTPS `Source`, current `Owner`,
   `Added at`, lifecycle disposition, and optional human-facing `Origin`. Allowed Kinds are
   `specification`, `prototype`, `design`, `research`, `baseline`, `reference`, and `runbook`.
   Another owner participates only when root selected it because its canonical state will actually
   change. Keep Asset and non-Asset effects separate.
3. Preserve identity while meaning continues. A superseded Asset names one active replacement; an
   archived Asset does not invent a replacement. Before an Effort concludes, transfer, supersede,
   or archive each active Asset it owns according to its actual continuing use. Historical inactive
   Assets may retain that Effort and their event times. A transfer preserves identity and Source;
   it does not change adoption. Supersession or archival of an adopted Asset includes every
   necessary Authority Baseline replacement or removal in the same accepted logical scope.
   Replacements must resolve, remain active, and be acyclic. Account for each transition and
   reason in the candidate; read destination eligibility without adding an unchanged destination
   file to the write set.

## After this operation

- **Required:** A changed owning planning object is validated by its own owner in the same accepted
  logical scope.
- **Consider:** Preserve semantic identity across ordinary content refinement.
- **Do not infer:** Citation, source availability, production, or Gate evidence changes Asset
  lifecycle or ownership. A missing or unreadable source does not rematerialize the project. HTTPS
  source availability remains unverified until a separate authorized check exists.

## Completion criterion

Only explicitly accepted Asset semantics changed, identity remains stable where meaning continues,
Citation effects stayed with citing owners, and no file or evidence was registered automatically.

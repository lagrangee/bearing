# Everyday workflows

[简体中文](everyday-workflows.zh-CN.md)

Use Bearing when the question is not just "can code be changed?" but "is this change aligned with the project?"

## Check a proposed change

Ask:

```text
Check this request against current direction, accepted decisions, and active work before implementing.
```

Expected result: the agent either confirms fit with sources or exposes a conflict.

## Run Bearing Project Orientation

Ask:

```text
Give me a Bearing Project Orientation from the current repository and existing work.
```

Project Orientation reads current project files, canonical planning, and a bounded transient view of existing work. It separates facts, inferences, evidence gaps, and unresolved questions, then returns current understanding, a completed baseline, the active-work landscape, a Project Summary draft, and zero or more future Roadmap/Gate candidates. It cites current source truth rather than summarizing chat history.

The result is read-only. It does not write the Summary, create planning or work, generate a Project Brief, or enroll standalone work. Any follow-up change still requires your explicit acceptance through its owning workflow.

### Related concepts

- **Bearing Project Orientation** is a read-only synthesis of current repository, planning, and bounded work evidence. It produces drafts and candidates, not canonical changes.
- **Bearing Scope Review** is the narrower transient comparison used to identify standalone work and possible enrollment candidates. It does not orient the whole project.
- **Project Summary** is the canonical accepted long-horizon synthesis. An Orientation can propose a Summary draft but cannot write it.
- **Project Brief** is derived only from qualifying accepted lifecycle transitions. Setup and Orientation never create it.

## Change the roadmap deliberately

When direction changes, ask for the decision:

```text
This changes the Roadmap. Show the consequence and ask me before updating governance.
```

Bearing keeps Roadmaps lightweight, but they are still accepted direction.

## Review a Milestone Gate

Gate readiness can be derived; Gate passage is a human decision.

Ask:

```text
Review whether this Gate is ready for passage and list evidence and exceptions.
```

## Run Planning Audit or Next Work

An explicit Planning Audit looks for material drift and may promote one deduplicated pending Planning Review. A Next Work request returns transient Agent judgment with one evidence-backed direction and only meaningful alternatives. Neither one starts implementation by itself.

## Review Bearing Scope

Bearing Scope Review is narrower than Project Orientation: it only compares the current managed scope with a transient Work Management inventory to identify standalone work and possible enrollment candidates. Later reviews run only when you explicitly ask. Bearing discards the inventory, recommendations, and dispositions after the review without persisting them. Standalone work enters managed scope only through a follow-up planning change you explicitly accept.

## Use Portal

Use Portal when visual inspection helps: Project Brief, Project Summary, active Roadmap focus, managed-scope Attention, managed contributing work, and evidence provenance. The Planning Audit view has current review, decisions awaiting attention, and accepted decision history. Standalone native-work inventory does not enter Portal. Keep transient Next Work judgment and every mutation in the owning Agent Surface flow.

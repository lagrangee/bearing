# Everyday workflows

[简体中文](everyday-workflows.zh-CN.md)

Use Bearing when the question is not just "can code be changed?" but "is this change aligned with the project?"

## Check a proposed change

Ask:

```text
Check this request against current direction, accepted decisions, and active work before implementing.
```

Expected result: the agent either confirms fit with sources or exposes a conflict.

## Reorient to the project

Ask:

```text
Orient me to the current Project Summary, focused Roadmap and Gate, active Efforts, and Attention.
```

This should cite current source truth rather than summarize chat history.

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

Planning Audit looks for material drift. Next Work Guidance suggests one primary direction and two alternatives. Neither one starts implementation by itself.

## Use Portal

Use Portal when visual inspection helps: project brief, roadmap focus, Attention, contributing work, and evidence provenance. Keep mutations in the owning Agent Surface flow.

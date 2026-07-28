# Release Smoke Slice

Status: ready-for-agent

## Problem Statement

An ordinary local repository needs to expose minimal planning context to Bearing without depending
on private maintainer history or generated project state.

## Solution

Use one deterministic Local Markdown effort with a Map, first-class Spec, and native task.

## User Stories

An agent can orient from the clean repository and preserve the accepted local-only boundary.

## Implementation Decisions

Keep the seed self-contained and free of generated Bearing state.

## Testing Decisions

Capture the seed through the production `matt-skills/v1` Local provider during release validation.

## Out of Scope

Remote publication, hosted project state, and private maintainer history are excluded.

## Further Notes

The fixture exists only to prove packaged lifecycle mechanics against valid native planning truth.

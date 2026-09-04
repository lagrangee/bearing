# Label Formatter Delivery

Status: ready-for-agent

## Problem Statement

Secondary label output is missing.

## Solution

Add one exported formatter with one focused test.

## User Stories

1. As a library consumer, I want secondary labels normalized consistently, so that surrounding whitespace and letter casing do not change their meaning.

## Implementation Decisions

- Add one exported secondary-label formatter alongside the existing primary-label formatter.
- Apply trim before lowercase conversion.

## Testing Decisions

The public seam is the exported `formatSecondaryLabel` function.

## Out of Scope

Primary-label behavior, package identity, and additional validation policy are unchanged.

## Further Notes

The delivery is intentionally small enough to complete in one focused Agent session.

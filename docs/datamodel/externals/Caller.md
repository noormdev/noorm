---
external: Caller
description: An operator or application requests a pipeline invocation or reads its history.
---

The actor is a CLI operator or SDK application, not a row in the identity registry. Both interfaces are proposals.

## What Caller does

- Sends a slug, selected config, identity/policy context, invoking version, optional single-run choice and dry-run choice.
- Receives a preview, rejection or busy result without a run, or an admitted run ID with declaration-level results and errors.
- Requests history by slug or a run ID and receives stored outcomes.

## Expectations

Each invocation is fresh and overlaps are allowed by default. Protected admission is scoped to config and slug; pending work can produce a busy response, not a queued or deduplicated run. Execution status is distinguished from confirmed commit, rollback, and uncertainty. Rendered SQL and secrets are not returned in normal results.

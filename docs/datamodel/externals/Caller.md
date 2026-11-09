---
external: Caller
description: An operator or application requests a pipeline invocation or reads its history.
---

The actor is a CLI operator or connected SDK application, not a row in the identity registry.

## What Caller does

- Selects a slug and config and supplies structured input through SDK input or CLI `--input` JSON and generated flags; the CLI offers definition-specific help and eligible missing-required prompts.
- Receives a sanitized preview, rejection or busy result without a run, or an admitted run ID with declaration-level results and primary and secondary errors.
- Requests config-scoped history by slug with an optional bounded limit, or one run by positive safe run ID, and receives stored outcomes.

## Expectations

Each invocation is fresh and overlaps are allowed by default. The manifest's `singleRun` choice protects admission by config and slug; pending work can produce busy, not a queued or deduplicated run. CLI flags override JSON, defaults fill gaps and only eligible interactive CLI sessions prompt; SDK never prompts. Execution status is distinguished from confirmed commit, rollback and uncertainty. Raw input and rendered SQL are not returned in normal results.

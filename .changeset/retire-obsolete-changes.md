---
"@noormdev/cli": minor
"@noormdev/sdk": minor
---

Declare obsolete changes in `.noorm/retired.yml` to keep them out of future runs without deleting their folders or execution history. Fast-forward in the TUI or interactive CLI can record retirement for changes with missing forward SQL after you confirm that supported databases have caught up and no longer need their rollback scripts. Unattended runs report missing forward files before running SQL.

The SDK exposes retirement separately from execution status and checks the full pending fast-forward batch before applying changes.

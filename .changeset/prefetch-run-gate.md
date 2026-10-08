---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

Decide which files to skip with one or two tracking queries per batch instead of one or two per file. Skipped files no longer write execution rows, and a build where nothing changed writes no operation record. The SDK's `run.file(path, { preview: true })` now renders without executing. The TUI's re-run confirmation now finds earlier runs.

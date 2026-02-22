---
"@noormdev/cli": major
"@noormdev/sdk": major
---

**BREAKING:** Reorganize flat `NoormOps` into domain-aligned sub-namespaces

The flat `ctx.noorm.*` API has been replaced with sub-namespaces that mirror the TUI home screen:

- `ctx.noorm.changes.*` — scaffold, discover, validate, apply, revert, ff, status, pending, history
- `ctx.noorm.run.*` — discover, preview, file, files, dir, build
- `ctx.noorm.db.*` — listTables, describeTable, overview, previewTeardown, truncate, teardown, reset
- `ctx.noorm.lock.*` — acquire, release, status, withLock, forceRelease
- `ctx.noorm.vault.*` — init, status, set, get, getAll, list, delete, exists, propagate, copy
- `ctx.noorm.secrets.*` — get
- `ctx.noorm.templates.*` — render
- `ctx.noorm.transfer.*` — to, plan
- `ctx.noorm.dt.*` — exportTable, importFile
- `ctx.noorm.utils.*` — checksum, testConnection

**Migration examples:**

| Before | After |
|--------|-------|
| `ctx.noorm.build()` | `ctx.noorm.run.build()` |
| `ctx.noorm.fastForward()` | `ctx.noorm.changes.ff()` |
| `ctx.noorm.applyChange(name)` | `ctx.noorm.changes.apply(name)` |
| `ctx.noorm.listTables()` | `ctx.noorm.db.listTables()` |
| `ctx.noorm.acquireLock()` | `ctx.noorm.lock.acquire()` |
| `ctx.noorm.truncate()` | `ctx.noorm.db.truncate()` |
| `ctx.noorm.runFile(f)` | `ctx.noorm.run.file(f)` |
| `ctx.noorm.transferTo(c)` | `ctx.noorm.transfer.to(c)` |

**New capabilities:** change authoring/scaffolding, dry-run previews, file discovery, vault operations, teardown preview

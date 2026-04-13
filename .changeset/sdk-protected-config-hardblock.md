---
"@noormdev/sdk": major
---

## Breaking Changes

### `allowProtected` option removed

The `allowProtected` option has been removed from `CreateContextOptions`. Passing it no longer has any effect — protected configs unconditionally block all destructive operations with no override.

**Before:**
```typescript
// This no longer works — allowProtected is not a valid option
const ctx = await createContext({ config: 'staging', allowProtected: true })
await ctx.noorm.db.truncate() // would proceed
```

**After:**
```typescript
// Protected configs always block destructive ops — no override possible
const ctx = await createContext({ config: 'staging' })
await ctx.noorm.db.truncate() // throws ProtectedConfigError
```

To run a destructive operation against a protected config, set `config.protected = false` manually before running the operation, then restore it.

### `checkProtectedConfig` signature changed

The exported `checkProtectedConfig` guard function signature changed from `(config, operation, options)` to `(config, operation)`. If you call this function directly, remove the third argument.

## New Behavior

The following operations are now blocked on protected configs (in addition to `truncate`, `teardown`, and `reset`):

- `ctx.noorm.dt.importFile()` — bulk data import is destructive
- `ctx.noorm.changes.revert()` — schema rollbacks are destructive in production
- `ctx.noorm.changes.rewind()` — batch schema rollbacks are destructive in production

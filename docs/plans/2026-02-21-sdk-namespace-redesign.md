# SDK Namespace Redesign


## Problem

The SDK (`ctx.noorm.*`) exposes ~25 methods flat on a single `NoormOps` class. Adding change authoring, dry-run previews, file discovery, and vault pushes it to ~40+. This flat structure doesn't match the mental model of the TUI/CLI, making it harder for users to transfer knowledge across interfaces.


## Design Principle

TUI, CLI, and SDK share the same mental model. The TUI home screen groups features by domain (`[g] changes`, `[r] run`, `[d] db`, `[l] lock`, etc.). The SDK should mirror this grouping via sub-namespaces on `ctx.noorm`.


## Namespace Map

```
TUI Home        SDK Namespace           Connection Required
─────────       ─────────────           ───────────────────
[c] config      ctx.noorm.config        no  (read-only prop)
[g] changes     ctx.noorm.changes       mixed (scaffold: no, apply/revert: yes)
[r] run         ctx.noorm.run           mixed (discover: no, execute: yes)
[d] db          ctx.noorm.db            yes
[l] lock        ctx.noorm.lock          yes
[s] settings    ctx.noorm.settings      no  (read-only prop)
[k] secrets     ctx.noorm.secrets       no
[i] identity    ctx.noorm.identity      no  (read-only prop)

                ctx.noorm.vault         yes
                ctx.noorm.templates     no
                ctx.noorm.transfer      yes
                ctx.noorm.dt            yes
                ctx.noorm.utils         mixed
```


## Namespace Details


### ctx.noorm.changes

Manages the full lifecycle of database changes — authoring, execution, and history.

```typescript
// Scaffold (offline — no connection needed)
const change = await ctx.noorm.changes.create({ description: 'add-user-roles' })
const updated = await ctx.noorm.changes.addFile(change, 'change', { name: 'create-table', type: 'sql' })
await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql')
await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name')
await ctx.noorm.changes.reorderFiles(change, 'change', ['002_b.sql', '001_a.sql'])
await ctx.noorm.changes.delete(change)

// Discovery & validation (offline)
const changes = await ctx.noorm.changes.discover()
const change = await ctx.noorm.changes.parse('2024-01-15-add-users')
ctx.noorm.changes.validate(change)

// Execution (connected)
await ctx.noorm.changes.apply('2024-01-15-add-users')
await ctx.noorm.changes.revert('2024-01-15-add-users')
await ctx.noorm.changes.ff()

// Status & history (connected)
const all = await ctx.noorm.changes.status()
const pending = await ctx.noorm.changes.pending()
const history = await ctx.noorm.changes.history(10)
```

**Core functions mapped:**
- `createChange` -> `create`
- `addFile` -> `addFile`
- `removeFile` -> `removeFile`
- `renameFile` -> `renameFile`
- `reorderFiles` -> `reorderFiles`
- `deleteChange` -> `delete`
- `discoverChanges` -> `discover`
- `parseChange` -> `parse`
- `validateChange` -> `validate`
- `ChangeManager.run` -> `apply`
- `ChangeManager.revert` -> `revert`
- `ChangeManager.ff` -> `ff`
- `ChangeManager.list` -> `status`
- (filtered list) -> `pending`
- `ChangeManager.getHistory` -> `history`


### ctx.noorm.run

Execute SQL files and discover file structure.

```typescript
// Discovery (offline)
const files = await ctx.noorm.run.discover('sql/')

// Preview / dry-run (connected — renders templates)
const results = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql'])

// Execution (connected)
await ctx.noorm.run.file('seeds/test-data.sql')
await ctx.noorm.run.files(['functions/utils.sql', 'triggers/audit.sql'])
await ctx.noorm.run.dir('seeds/')
await ctx.noorm.run.build({ force: true })
```

**Core functions mapped:**
- `discoverFiles` -> `discover`
- `preview` -> `preview`
- `coreRunFile` -> `file`
- `coreRunFiles` -> `files`
- `coreRunDir` -> `dir`
- `runBuild` -> `build`


### ctx.noorm.db

Database exploration and destructive schema operations.

```typescript
// Explore (connected)
const tables = await ctx.noorm.db.listTables()
const detail = await ctx.noorm.db.describeTable('users')
const overview = await ctx.noorm.db.overview()

// Preview (connected)
const preview = await ctx.noorm.db.previewTeardown()

// Destructive (connected, respects allowProtected)
await ctx.noorm.db.truncate()
await ctx.noorm.db.teardown()
await ctx.noorm.db.reset()
```

**Core functions mapped:**
- `fetchList` -> `listTables`
- `fetchDetail` -> `describeTable`
- `fetchOverview` -> `overview`
- `previewTeardown` -> `previewTeardown`
- `truncateData` -> `truncate`
- `teardownSchema` -> `teardown`
- `teardown + build` -> `reset`


### ctx.noorm.lock

Database lock management.

```typescript
const lock = await ctx.noorm.lock.acquire({ timeout: 60000 })
await ctx.noorm.lock.release()
const status = await ctx.noorm.lock.status()
await ctx.noorm.lock.withLock(async () => { ... })
await ctx.noorm.lock.forceRelease()
```


### ctx.noorm.vault

Encrypted team secrets stored in the database.

```typescript
// Lifecycle (connected)
await ctx.noorm.vault.init()
const status = await ctx.noorm.vault.status()

// CRUD (connected)
await ctx.noorm.vault.set('API_KEY', 'sk-live-...')
const value = await ctx.noorm.vault.get('API_KEY')
const all = await ctx.noorm.vault.getAll()
const keys = await ctx.noorm.vault.list()
await ctx.noorm.vault.delete('OLD_KEY')
const exists = await ctx.noorm.vault.exists('API_KEY')

// Team (connected)
await ctx.noorm.vault.propagate()
await ctx.noorm.vault.copy(destConfig)
```

**Core functions mapped:**
- `initializeVault` -> `init`
- `getVaultStatus` -> `status`
- `setVaultSecret` -> `set`
- `getVaultSecret` -> `get`
- `getAllVaultSecrets` -> `getAll`
- `listVaultSecretKeys` -> `list`
- `deleteVaultSecret` -> `delete`
- `vaultSecretExists` -> `exists`
- `propagateVaultKey` -> `propagate`
- `copyVaultSecrets` -> `copy`


### ctx.noorm.secrets

Local config-scoped secrets (from state file, not vault).

```typescript
const apiKey = ctx.noorm.secrets.get('API_KEY')
```


### ctx.noorm.templates

Template rendering.

```typescript
const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl')
```


### ctx.noorm.transfer

Cross-database data transfer.

```typescript
const [plan, err] = await ctx.noorm.transfer.plan(destConfig)
const [result, err] = await ctx.noorm.transfer.to(destConfig, { tables: ['users'] })
```


### ctx.noorm.dt

DT file import/export.

```typescript
const [result, err] = await ctx.noorm.dt.exportTable('users', './exports/users.dtz')
const [result, err] = await ctx.noorm.dt.importFile('./exports/users.dtz')
```


### ctx.noorm.utils

Utilities that don't fit a specific domain.

```typescript
const checksum = await ctx.noorm.utils.checksum('sql/001.sql')
const result = await ctx.noorm.utils.testConnection()
```


## Architecture


### Implementation Pattern

Each namespace is a small class, lazily instantiated by `NoormOps`:

```typescript
// src/sdk/namespaces/changes.ts
export class ChangesNamespace {

    #state: ContextState;

    constructor(state: ContextState) {
        this.#state = state;
    }

    async create(options: CreateChangeOptions): Promise<Change> {
        const changesDir = path.join(
            this.#state.projectRoot,
            this.#state.settings.paths?.changes ?? 'changes',
        );
        return createChange(changesDir, options);
    }

    // ...
}
```

`NoormOps` becomes a thin shell:

```typescript
export class NoormOps {

    #state: ContextState;
    #changes: ChangesNamespace | null = null;
    #run: RunNamespace | null = null;
    // ...

    get changes(): ChangesNamespace {
        if (!this.#changes) this.#changes = new ChangesNamespace(this.#state);
        return this.#changes;
    }

    get run(): RunNamespace {
        if (!this.#run) this.#run = new RunNamespace(this.#state);
        return this.#run;
    }

    // Read-only props stay on NoormOps
    get config(): Config { return this.#state.config; }
    get settings(): Settings { return this.#state.settings; }
    get identity(): Identity { return this.#state.identity; }
    get observer() { return observer; }
}
```


### File Structure

```
src/sdk/
├── index.ts              # createContext, re-exports
├── context.ts            # Context class (unchanged)
├── noorm-ops.ts          # Thin shell with lazy namespace getters
├── state.ts              # ContextState (unchanged)
├── guards.ts             # Safety checks (unchanged)
├── sql.ts                # Proc/func builders (unchanged)
├── types.ts              # SDK-level types (unchanged)
└── namespaces/
    ├── changes.ts        # ChangesNamespace
    ├── run.ts            # RunNamespace
    ├── db.ts             # DbNamespace
    ├── lock.ts           # LockNamespace
    ├── vault.ts          # VaultNamespace
    ├── secrets.ts        # SecretsNamespace
    ├── templates.ts      # TemplatesNamespace
    ├── transfer.ts       # TransferNamespace
    ├── dt.ts             # DtNamespace
    └── utils.ts          # UtilsNamespace
```


### New Types to Export

```typescript
// Change scaffold types
export type { Change, ChangeFile, CreateChangeOptions, AddFileOptions } from '../core/change/types.js';

// Teardown preview
export type { TeardownPreview } from '../core/teardown/index.js';

// Vault types
export type { VaultSecret, VaultStatus, VaultCopyResult, VaultPropagationResult } from '../core/vault/index.js';

// Change errors (for catching)
export {
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    ManifestReferenceError,
} from '../core/change/types.js';
```


## Breaking Changes

This is a breaking change to the SDK API. All existing `ctx.noorm.*` method calls must be updated:

| Before | After |
|--------|-------|
| `ctx.noorm.applyChange(name)` | `ctx.noorm.changes.apply(name)` |
| `ctx.noorm.revertChange(name)` | `ctx.noorm.changes.revert(name)` |
| `ctx.noorm.fastForward()` | `ctx.noorm.changes.ff()` |
| `ctx.noorm.getChangeStatus()` | `ctx.noorm.changes.status()` |
| `ctx.noorm.getPendingChanges()` | `ctx.noorm.changes.pending()` |
| `ctx.noorm.getHistory(n)` | `ctx.noorm.changes.history(n)` |
| `ctx.noorm.build()` | `ctx.noorm.run.build()` |
| `ctx.noorm.runFile(f)` | `ctx.noorm.run.file(f)` |
| `ctx.noorm.runFiles(fs)` | `ctx.noorm.run.files(fs)` |
| `ctx.noorm.runDir(d)` | `ctx.noorm.run.dir(d)` |
| `ctx.noorm.listTables()` | `ctx.noorm.db.listTables()` |
| `ctx.noorm.describeTable(n)` | `ctx.noorm.db.describeTable(n)` |
| `ctx.noorm.overview()` | `ctx.noorm.db.overview()` |
| `ctx.noorm.truncate()` | `ctx.noorm.db.truncate()` |
| `ctx.noorm.teardown()` | `ctx.noorm.db.teardown()` |
| `ctx.noorm.reset()` | `ctx.noorm.db.reset()` |
| `ctx.noorm.acquireLock()` | `ctx.noorm.lock.acquire()` |
| `ctx.noorm.releaseLock()` | `ctx.noorm.lock.release()` |
| `ctx.noorm.getLockStatus()` | `ctx.noorm.lock.status()` |
| `ctx.noorm.withLock(fn)` | `ctx.noorm.lock.withLock(fn)` |
| `ctx.noorm.forceReleaseLock()` | `ctx.noorm.lock.forceRelease()` |
| `ctx.noorm.renderTemplate(f)` | `ctx.noorm.templates.render(f)` |
| `ctx.noorm.getSecret(k)` | `ctx.noorm.secrets.get(k)` |
| `ctx.noorm.computeChecksum(f)` | `ctx.noorm.utils.checksum(f)` |
| `ctx.noorm.testConnection()` | `ctx.noorm.utils.testConnection()` |
| `ctx.noorm.transferTo(c)` | `ctx.noorm.transfer.to(c)` |
| `ctx.noorm.transferPlan(c)` | `ctx.noorm.transfer.plan(c)` |
| `ctx.noorm.exportTable(...)` | `ctx.noorm.dt.exportTable(...)` |
| `ctx.noorm.importFile(...)` | `ctx.noorm.dt.importFile(...)` |

Acceptable during alpha.

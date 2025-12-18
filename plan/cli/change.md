# CLI Change Screens


## Overview

The Change module provides screens for managing database changesets - the core unit of schema evolution in noorm. Users can view, create, apply, and revert changesets through these screens.


## Screens

| Screen | Route | Purpose |
|--------|-------|---------|
| List | `change` | View all changesets with applied/pending status |
| Add | `change/add` | Create new changeset folder structure |
| Edit | `change/edit` | Open changeset in system editor |
| Remove | `change/rm` | Delete changeset from filesystem |
| Run | `change/run` | Apply a specific changeset |
| Revert | `change/revert` | Rollback a specific changeset |
| Next | `change/next` | Apply next N pending changesets |
| FF | `change/ff` | Fast-forward all pending changesets |
| Rewind | `change/rewind` | Revert multiple changesets in reverse order |


## Data Model

```
Changeset
├── name: string              # Folder name (e.g., "2025-01-15-add-users")
├── path: string              # Absolute path to changeset folder
├── date: Date | null         # Parsed from folder name prefix
├── description: string       # Description portion of folder name
├── changeFiles: ChangesetFile[]   # Files in change/ folder
├── revertFiles: ChangesetFile[]   # Files in revert/ folder
└── hasChangelog: boolean     # Whether changelog.md exists

ChangesetFile
├── filename: string          # e.g., "001_create-table.sql"
├── path: string              # Absolute path to file
└── type: 'sql' | 'txt'       # sql/sql.tmpl or txt manifest

ChangesetListItem (from manager.list())
├── name: string
├── status: 'pending' | 'success' | 'failed' | 'reverted'
├── appliedAt: Date | null
├── appliedBy: string | null
├── revertedAt: Date | null
├── isNew: boolean            # Exists on disk but no DB record
└── orphaned: boolean         # In DB but folder deleted
```


## Architecture

```mermaid
flowchart TB
    subgraph CLI["CLI Layer"]
        List[List Screen]
        Add[Add Screen]
        Run[Run Screen]
        Revert[Revert Screen]
        Next[Next Screen]
        FF[FF Screen]
    end

    subgraph Core["Core Layer"]
        SM[StateManager]
        CM[ChangesetManager]
        Conn[Connection]
    end

    subgraph Storage["Storage"]
        FS[Filesystem]
        DB[(Database)]
    end

    List --> SM
    List --> CM
    Add --> SM
    Add --> FS
    Run --> CM
    Revert --> CM
    Next --> CM
    FF --> CM

    CM --> Conn
    Conn --> DB
    CM --> FS
    SM --> FS
```


## Screen Workflows


### List Screen

Shows all changesets with their status (applied/pending).

```
┌─────────────────────────────────────────┐
│ Changesets                              │
│                                         │
│ Total: 12  Applied: 8  Pending: 4       │
│                                         │
│ ✓ 2025-01-10-initial-schema    today    │
│ ✓ 2025-01-12-add-users         2d ago   │
│ ○ 2025-01-15-add-roles         pending  │
│ ○ 2025-01-16-add-permissions   pending  │
│                                         │
│ [a]dd [r]un [v]ert [n]ext [f]f [w]ind   │
└─────────────────────────────────────────┘
```

**Flow:**
1. Load active config from StateManager
2. Connect to database
3. Fetch changesets from filesystem
4. Fetch applied status from tracking table
5. Merge and display with status indicators

**Keyboard:**
- `a` → Navigate to Add screen
- `e` → Navigate to Edit screen (selected)
- `d` → Navigate to Remove screen (selected)
- `r` → Navigate to Run screen (if pending)
- `v` → Navigate to Revert screen (if applied)
- `n` → Navigate to Next screen
- `f` → Navigate to FF screen
- `w` → Navigate to Rewind screen
- `Enter` → Run or Revert based on status


### Add Screen

Creates a new changeset folder with template files.

**Flow:**
1. Prompt for changeset name
2. Generate folder name: `{date}_{sanitized-name}`
3. Create folder structure:
   ```
   changesets/{name}/
   ├── change/
   │   └── 001_change.sql
   └── revert/
       └── 001_revert.sql
   ```
4. Navigate back to List

**Naming Convention:**
- Date prefix: `YYYY-MM-DD`
- Name: lowercase, hyphens, alphanumeric only
- Example: `2025-01-15-add-user-roles`


### Run Screen

Applies a single changeset to the database.

```mermaid
flowchart TD
    Start([Start]) --> LoadConfig[Load Config]
    LoadConfig --> CheckProtected{Protected?}

    CheckProtected -->|Yes| ConfirmProtected[Protected Confirm]
    CheckProtected -->|No| Execute

    ConfirmProtected -->|Confirmed| Execute[Execute Changeset]
    ConfirmProtected -->|Cancelled| Cancel([Cancel])

    Execute --> Success{Success?}
    Success -->|Yes| ShowSuccess[Show Success]
    Success -->|No| ShowError[Show Error]

    ShowSuccess --> Done([Done])
    ShowError --> Done
```

**Protected Confirmation:**
For protected configs, requires typing the config name to confirm destructive operations.


### Revert Screen

Rolls back a previously applied changeset.

**Flow:**
1. Load config and verify changeset is applied
2. Show confirmation (protected or standard)
3. Execute revert SQL files
4. Remove from tracking table
5. Show result


### Next Screen

Applies the next N pending changesets in order.

**Flow:**
1. Prompt for count (default: 1)
2. Show confirmation for protected configs
3. Execute changesets sequentially
4. Show status list with results for each


### Fast-Forward Screen

Applies all pending changesets at once.

**Flow:**
1. Load pending changesets
2. Show list preview (first 5 + count of remaining)
3. Confirm (protected or standard)
4. Execute all sequentially
5. Show summary with success/failure counts


### Rewind Screen

Reverts multiple changesets in reverse chronological order.

**Arguments:**

| Argument | Behavior |
|----------|----------|
| `rewind 3` | Revert last 3 applied changesets |
| `rewind 2025-01-15-add-email` | Revert until (and including) this changeset |

**Flow:**
1. Parse argument (count or changeset name)
2. Determine changesets to revert (reverse chronological order)
3. Show list of changesets that will be reverted
4. Confirm (protected or standard)
5. Execute reverts sequentially
6. Show summary with success/failure counts

**Validation:**
- If count: Must have at least N applied changesets
- If name: Changeset must exist and be applied


## State Management

Each screen follows a phase-based state pattern:

```
Phase Flow:
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────┐
│ loading │ -> │ confirm │ -> │ running │ -> │ done │
└─────────┘    └─────────┘    └─────────┘    └──────┘
                    │                             │
                    v                             v
               ┌─────────┐                   ┌─────────┐
               │ (cancel)│                   │  error  │
               └─────────┘                   └─────────┘
```

**Phases:**
- `loading` - Fetching config, connection, changeset data
- `confirm` - Awaiting user confirmation (especially for protected)
- `running` - Executing SQL, showing progress
- `done` - Showing results
- `error` - Displaying error message


## Observer Events

Screens subscribe to core events for progress updates:

| Event | Payload | Description |
|-------|---------|-------------|
| `changeset:created` | `{ name, path }` | New changeset scaffolded |
| `changeset:start` | `{ name, direction, files }` | Execution starting |
| `changeset:file` | `{ changeset, filepath, index, total }` | File being executed |
| `changeset:complete` | `{ name, direction, status, durationMs }` | Execution finished |
| `changeset:skip` | `{ name, reason }` | Changeset skipped |

Progress is displayed via ProgressBar component during execution, subscribing to `changeset:file` events.


## Core Integration

### Dependencies

| Module | Source | Purpose |
|--------|--------|---------|
| StateManager | `src/core/state/` | Active config, secrets |
| SettingsManager | `src/core/settings/` | Paths configuration |
| ChangesetManager | `src/core/changeset/manager.ts` | All changeset operations |
| Connection | `src/core/connection/` | Database connections |
| Identity | `src/core/identity/` | User identity resolution |

### ChangesetManager Operations

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `list()` | - | `ChangesetListItem[]` | All changesets with merged disk/DB status |
| `run(name, opts)` | changeset name | `ChangesetResult` | Apply single changeset |
| `revert(name, opts)` | changeset name | `ChangesetResult` | Rollback single changeset |
| `next(count, opts)` | number | `BatchChangesetResult` | Apply next N pending |
| `ff(opts)` | - | `BatchChangesetResult` | Fast-forward all pending |
| `rewind(target, opts)` | number or name | `BatchChangesetResult` | Revert N or to specific changeset |
| `getHistory(name?, limit?)` | optional filters | `ChangesetHistoryRecord[]` | Execution history |
| `remove(name, opts)` | name + `{disk, db}` | void | Delete from disk/database |

### Context Requirements

ChangesetManager requires a `ChangesetContext` containing:
- Database connection (from Connection factory)
- Config name (from StateManager)
- Identity (from Identity resolver)
- Project root path
- Changesets directory path (from SettingsManager)
- Schema directory path (from SettingsManager)
- Secrets for template rendering (from StateManager)

See: `src/core/changeset/types.ts` for full type definitions.


## Protected Config Handling

Protected configs require explicit confirmation for destructive operations:

```
┌─────────────────────────────────────────┐
│ ⚠ Protected Configuration               │
│                                         │
│ You are about to run changeset          │
│ "add-user-roles" on "production".       │
│                                         │
│ Type "yes-production" to confirm:       │
│ > yes-prod_                             │
│                                         │
└─────────────────────────────────────────┘
```

This applies to: Run, Revert, Next, and FF screens.


## Error Handling

All async operations use `attempt()` pattern:

```
load config     -> error: "Failed to load state"
connect         -> error: "Connection failed: {message}"
execute         -> error: "{error message from DB}"
```

Errors transition screen to `error` phase with message display.


## References

**Documentation:**
- `docs/changeset.md` - Changeset architecture and execution
- `docs/template.md` - Eta templating for SQL files

**Core modules:**
- `src/core/changeset/` - ChangesetManager, parser, executor, history
- `src/core/template/` - Template rendering for .sql.eta files
- `src/core/runner/` - Shared execution patterns

**CLI plans:**
- `plan/cli/userflow.md` - User journeys, screen mockups, shared components

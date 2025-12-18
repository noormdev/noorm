# CLI DB Screens


## Overview

The DB section provides database lifecycle management operations:

- **create** - Build database schema from SQL files
- **destroy** - Drop all managed objects and reset tracking

These are high-risk operations requiring protected confirmation for non-development environments.


## File Structure

```
src/cli/screens/
├── db/
│   ├── index.tsx            # DB section exports
│   ├── DbListScreen.tsx     # DB operations overview
│   ├── DbCreateScreen.tsx   # Create database schema
│   └── DbDestroyScreen.tsx  # Destroy database objects
```


## Screen Flow

```mermaid
graph TD
    subgraph DB Section
        List[DbListScreen]
        Create[DbCreateScreen]
        Destroy[DbDestroyScreen]
    end

    List -->|"[c] create"| Create
    List -->|"[d] destroy"| Destroy
    Create -->|"Esc"| List
    Destroy -->|"Esc"| List
```


## DB List Screen

Entry point showing database status and available actions.

### Data Requirements

- Active configuration name
- Connection status (can we reach the database?)
- Count of tracked objects in the database

### Display

```
┌─────────────────────────────────────────────────────┐
│ Database Operations                                 │
│                                                     │
│ Config: dev                                         │
│ Connection: [OK]                                    │
│ Tracked Objects: 15                                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Available Actions                                   │
│                                                     │
│ [c] Create Schema - Build database from scratch     │
│ [d] Destroy Schema - Drop all managed objects       │
└─────────────────────────────────────────────────────┘

Warning: These operations modify the database schema directly.
```

### Keyboard

| Key | Action |
|-----|--------|
| `c` | Navigate to create screen |
| `d` | Navigate to destroy screen |
| `Esc` | Go back |


## DB Create Screen

Executes SQL files to build database schema.

### Phase Flow

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Options: config loaded
    Loading --> Error: load failed

    Options --> Confirm: protected config
    Options --> Running: unprotected or dry-run

    Confirm --> Running: user confirms
    Confirm --> Options: user cancels

    Running --> Done: complete
    Running --> Error: failed

    Done --> [*]
    Error --> [*]
```

### Options

| Option | Description |
|--------|-------------|
| `force` | Rebuild all files ignoring checksums |
| `dryRun` | Preview changes without executing |

### Logic Flow

```
loadConfig()
    -> get active config from state manager
    -> check if config is protected
    -> show options phase

handleConfirm()
    -> if protected AND not dry-run: show confirm phase
    -> else: proceed to run

runCreate()
    -> connect to database
    -> create Runner instance
    -> execute build operation
    -> emit completion events
    -> show results
```

### Protected Confirmation

For protected configurations (non-dev environments), users must type a confirmation phrase before proceeding:

```
Type "yes-{configName}" to confirm: _
```


## DB Destroy Screen

Drops all tracked database objects and optionally resets tracking tables.

### Phase Flow

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Preview: objects loaded
    Loading --> Error: load failed

    Preview --> Confirm: user proceeds
    Confirm --> Running: user confirms
    Confirm --> Preview: user cancels

    Running --> Done: complete
    Running --> Error: failed

    Done --> [*]
    Error --> [*]
```

### Options

| Option | Description |
|--------|-------------|
| `dropTables` | Drop the actual database objects |
| `resetTracking` | Clear the tracking tables |

### Logic Flow

```
loadPreview()
    -> get active config from state manager
    -> connect to database
    -> query tracking tables for object list
    -> group objects by type for display

handleConfirm()
    -> always show confirm phase (destroy is always protected)

runDestroy()
    -> connect to database
    -> if dropTables: drop objects in reverse dependency order
    -> if resetTracking: clear tracking tables
    -> emit completion events
    -> show results
```

### Object Type Inference

Objects are categorized by examining their file paths:

| Path Pattern | Type |
|--------------|------|
| `*view*` | view |
| `*function*`, `*func*` | function |
| `*procedure*`, `*proc*` | procedure |
| `*trigger*` | trigger |
| `*index*` | index |
| default | table |

### Drop Order

Objects are dropped in reverse creation order to handle dependencies correctly.


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `db:creating` | `{ configName, database }` | Database creation starting |
| `db:created` | `{ configName, database, durationMs }` | Database created |
| `db:destroying` | `{ configName, database }` | Database destruction starting |
| `db:destroyed` | `{ configName, database }` | Database destroyed |
| `db:bootstrap` | `{ configName, tables }` | noorm tracking tables created |
| `build:start` | `{ schemaPath, fileCount }` | Schema build starting |
| `build:complete` | `{ status, filesRun, filesSkipped, filesFailed, durationMs }` | Schema build complete |


## Headless Mode

Both operations support headless execution for CI/CD:

```bash
noorm db:create [config] [--force] [--dry-run]
noorm db:destroy [config] [--drop-tables] [--reset-tracking] [--yes]
```

The `--yes` flag bypasses protected confirmation (use with caution).


## Core Integration

### Dependencies

| Module | Source | Purpose |
|--------|--------|---------|
| StateManager | `src/core/state/` | Active config retrieval |
| Connection | `src/core/connection/` | Database connections |
| Runner | `src/core/runner/` | Schema build on create |
| DB | `src/core/db/` | Create/destroy operations |
| Observer | `src/core/observer.ts` | Lifecycle events |

### DB Module Operations

| Operation | Purpose |
|-----------|---------|
| `createDatabase` | Create database + bootstrap tracking tables |
| `destroyDatabase` | Drop objects + optionally reset tracking |
| `bootstrapTables` | Create __noorm_* tracking tables |

See: `src/core/db/` for implementation details.


## References

**Documentation:**
- `docs/runner.md` - Runner for schema build on create

**Core modules:**
- `src/core/connection/` - Connection factory
- `src/core/runner/` - Schema build execution
- `src/core/shared/` - Tracking table definitions

**CLI plans:**
- `plan/cli/userflow.md` - User journeys, screen mockups, shared components

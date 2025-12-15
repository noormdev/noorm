# Changeset


## Overview

Changesets are versioned database modifications applied after the initial schema build. Unlike "migrations", changesets acknowledge that you're modifying state, not moving data between locations.

**Core Capabilities:**

- Apply forward changes (`change/`)
- Rollback changes (`revert/`)
- Track execution history
- Reference existing build SQL files


## Concepts


### Changeset

A changeset is a folder containing modifications to apply to the database:

```
2024-01-15-add-email-verification/
├── change/           # Files to apply
├── revert/           # Files to undo
└── changelog.md      # Documentation
```

**Naming:** `YYYY-MM-DD-description` format ensures chronological ordering.


### File Types

| Extension | Purpose |
|-----------|---------|
| `.sql` | New SQL statements to execute |
| `.txt` | Manifest referencing existing build SQL files (one path per line) |

**.txt Example:**

```
schema/tables/verification_tokens.sql
schema/views/active_users.sql
```

Paths are relative to the schema/build directory. User is responsible for writing corresponding revert logic.


### Execution Status

```
┌─────────┐
│ pending │ ── run ──► ┌─────────┐
└─────────┘            │ success │
     ▲                 └────┬────┘
     │                      │
  revert                 revert
     │                      │
     │                      ▼
┌──────────┐           ┌──────────┐
│  failed  │ ◄── fail  │ reverted │
└──────────┘           └──────────┘
```

| Status | Meaning |
|--------|---------|
| `pending` | Not yet applied |
| `success` | Applied successfully |
| `failed` | Execution failed (can retry) |
| `reverted` | Was applied, then rolled back (can re-apply) |


## Data Models


### Changeset (parsed from disk)

```
Changeset {
    name: string              # Folder name
    path: string              # Full path
    date: Date | null         # Parsed from name
    description: string       # Human-readable from name
    changeFiles: ChangesetFile[]
    revertFiles: ChangesetFile[]
    hasChangelog: boolean
}

ChangesetFile {
    filename: string          # e.g., "001_alter-users.sql"
    path: string              # Full path
    type: 'sql' | 'txt'
    resolvedPaths?: string[]  # For .txt files, the referenced paths
    status?: 'pending' | 'success' | 'failed' | 'skipped'
    skipReason?: string       # e.g., "changeset failed"
}
```


### ChangesetStatus (from database)

```
ChangesetStatus {
    name: string
    status: 'pending' | 'success' | 'failed' | 'reverted'
    appliedAt: Date | null
    appliedBy: string | null
    revertedAt: Date | null
    errorMessage: string | null
}
```


## Tracking Tables

All database operations are tracked relationally. Every operation (build, run, changeset) creates a parent record, with individual file executions as children.


### `__noorm_changeset__`

Tracks all operation batches - explicit changesets, builds, and ad-hoc runs.

| Column | Type | Purpose |
|--------|------|---------|
| id | serial | Primary key |
| name | varchar | Operation identifier (see naming below) |
| change_type | varchar | `'build'`, `'run'`, `'changeset'` |
| direction | varchar | `'change'` or `'revert'` |
| checksum | varchar | SHA-256 of sorted file checksums (operation integrity) |
| executed_at | timestamp | When executed |
| executed_by | varchar | Identity string |
| config_name | varchar | Which config was used |
| cli_version | varchar | noorm version that created this operation |
| status | varchar | `'pending'`, `'success'`, `'failed'`, `'reverted'` |
| error_message | text | Error details if failed |
| duration_ms | integer | Execution time |

**Checksum calculation:**

```
changeset.checksum = SHA256(
    sorted(files.map(f => f.checksum)).join('')
)
```

This enables detection of:
- Modified files after execution
- Drift between environments
- Integrity verification on re-runs

**Name formats by change_type:**

| Type | Name Format | Example |
|------|-------------|---------|
| `changeset` | Folder name | `2024-01-15_add-users` |
| `build` | `build:{timestamp}` | `build:2024-01-15T10:30:00` |
| `run` | `run:{timestamp}` | `run:2024-01-15T10:30:00` |


### `__noorm_executions__`

Tracks individual file executions. Every file execution belongs to a parent changeset record.

| Column | Type | Purpose |
|--------|------|---------|
| id | serial | Primary key |
| changeset_id | integer | FK to `__noorm_changeset__` (required) |
| filepath | varchar | File that was executed |
| file_type | varchar | `'sql'` or `'txt'` |
| checksum | varchar | SHA-256 of file contents |
| cli_version | varchar | noorm version that executed this file |
| status | varchar | `'pending'`, `'success'`, `'failed'`, `'skipped'` |
| error_message | text | Error details if failed |
| skip_reason | varchar | Reason for skip (e.g., `'changeset failed'`, `'unchanged'`) |
| duration_ms | integer | Execution time |

**Relationship:** Every execution record has a parent changeset. No nullable foreign keys.


## CLI Commands


### `noorm change add` (Interactive Only)

Creates a new changeset through a step-by-step form.

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Scope                                          │
│                                                         │
│  What is the scope of this change?                      │
│  > add email verification                               │
│                                                         │
│  Creates: 2024-01-15-add-email-verification/            │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Add File                                       │
│                                                         │
│  File name: > alter users table                         │
│                                                         │
│  Type:                                                  │
│    ○ New SQL (write new statements)                     │
│    ○ Rerun existing files (pick from build)            │
│                                                         │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  (if "Rerun existing files" selected)                   │
│                                                         │
│  FilePicker: Select SQL files to include                │
│    ☑ schema/tables/tokens.sql                          │
│    ☐ schema/tables/users.sql                           │
│    ☑ schema/views/active_users.sql                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Add another file?                                      │
│    ○ Yes  ○ No                                          │
└─────────────────────────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │ Yes                     │ No
            ▼                         ▼
    (loop back to Step 2)    ┌────────────────────┐
                             │  STEP 3: Review    │
                             │                    │
                             │  Structure:        │
                             │  ├── change/       │
                             │  │   ├── 001_...   │
                             │  │   └── 002_...   │
                             │  ├── revert/       │
                             │  │   ├── 001_...   │
                             │  │   └── 002_...   │
                             │  └── changelog.md  │
                             │                    │
                             │  Accept? [y/N]     │
                             └────────────────────┘
```

**Does not support headless mode.** Error if run in CI/non-TTY.


### `noorm change edit <name>` (Interactive Only)

Modify an existing changeset's file structure.

**Capabilities:**

| Action | Behavior |
|--------|----------|
| Sort | Reorder files → auto-renumbers `001_`, `002_`, etc. |
| Rename | Change descriptive part of filename |
| Remove | Delete from both `change/` and `revert/` |
| Add | Same flow as `add` command |

Actual SQL content is edited by user in their own editor.

**Does not support headless mode.**


### `noorm change run [name]`

Apply a changeset.

| Context | Behavior |
|---------|----------|
| `name` provided | Run that changeset |
| `name` omitted + interactive | FilePicker shows changeset folders |
| `name` omitted + headless | **Error** - name required |

**Flow:**

```
1. Parse changeset from disk
2. Validate structure
3. Show summary of files to execute
4. Prompt for confirmation (unless --yes)
5. Create pending record in __noorm_changeset__
6. For each file:
   a. Create pending record in __noorm_executions__
   b. Execute SQL
   c. Update file record (success/failed)
7. Update changeset record (success/failed)
```


### `noorm change revert [name]`

Undo a changeset.

- Same name resolution rules as `run`
- Files executed in **reverse order**
- Updates original changeset status to `reverted`


### `noorm change next [n]`

Apply next N pending changesets (default: 1).

- Interactive: Summary + confirmation
- Headless: Runs directly


### `noorm change ff`

Fast-forward: Apply all pending changesets.

Same behavior as `next` with no limit.


### `noorm change rewind [n|name]`

Revert changesets in reverse chronological order.

| Argument | Behavior |
|----------|----------|
| `rewind 3` | Revert last 3 applied changesets |
| `rewind 2024-01-15-add-email` | Revert until (and including) this changeset |


### `noorm change list`

List all changesets with status.

```
Changesets:
  ✓ 2024-01-15-add-email-verification
      Applied: 2024-01-15T10:30:00Z by john@example.com
  ✓ 2024-01-20-add-user-roles
      Applied: 2024-01-20T14:00:00Z by jane@example.com
  ↩ 2024-02-01-optimize-indexes
      Reverted: 2024-02-05T09:00:00Z
  ✗ 2024-02-15-add-audit-logs
      Error: Column 'created_at' already exists
  ○ 2024-03-01-add-user-preferences
      Pending
```


## Execution Flow


### Running a Changeset

```
                    ┌──────────────┐
                    │ Parse from   │
                    │ disk         │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Validate     │──── invalid ────► Error
                    │ structure    │
                    └──────┬───────┘
                           │ valid
                           ▼
                    ┌──────────────┐
                    │ Check status │──── already ────► Error
                    │ in DB        │     applied
                    └──────┬───────┘
                           │ pending/reverted
                           ▼
                    ┌──────────────┐
                    │ Acquire lock │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Create       │
                    │ pending      │
                    │ record       │
                    └──────┬───────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ For each file:         │
              │                        │
              │  .sql → execute        │
              │  .txt → resolve paths, │
              │         execute each   │
              │                        │
              │  Record file result    │
              └────────────┬───────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         all success               any failed
              │                         │
              ▼                         ▼
       ┌────────────┐           ┌────────────────────────┐
       │ Status:    │           │ Changeset: failed      │
       │ success    │           │ Failed file: failed    │
       └────────────┘           │ Pending files: skipped │
                                │   (reason: changeset   │
                                │    failed)             │
                                └────────────────────────┘
```


### Reverting a Changeset

Same flow as running, except:

1. Files processed in **reverse order**
2. On success, original changeset marked `reverted`


## File Structure

```
src/core/changeset/
├── index.ts        # Public exports
├── types.ts        # Interfaces and types
├── parser.ts       # Parse changeset from disk
├── scaffold.ts     # Create/edit changeset directories
├── history.ts      # Database tracking operations
├── executor.ts     # Execute changesets
└── manager.ts      # High-level operations (list, run, revert, etc.)
```


## Observer Events

| Event | When Emitted |
|-------|--------------|
| `changeset:created` | New changeset directory created |
| `changeset:start` | Beginning changeset execution |
| `changeset:file` | About to execute a file |
| `changeset:complete` | Changeset execution finished |
| `error` | Any error during execution |


## Error Cases

| Error | Cause | Resolution |
|-------|-------|------------|
| Already applied | Changeset status is `success` | Revert first |
| Cannot revert | Changeset not applied | Run it first |
| No revert files | Missing `revert/` directory | Add revert scripts |
| Name required | Headless mode without name | Provide name argument |
| Empty .txt file | No valid paths in manifest | Add file references |


## Best Practices

1. **Date-prefix changesets** - `YYYY-MM-DD-description` for ordering
2. **Always write revert scripts** - Even if just DROP statements
3. **One logical change per changeset** - Don't bundle unrelated changes
4. **Test locally first** - Use test database before production
5. **Number files** - Use `001_`, `002_` for execution order
6. **Use .txt for existing SQL** - Reference build files instead of duplicating
7. **Document in changelog.md** - Business reason, side effects, impact
8. **Keep changesets small** - Easier to debug and revert

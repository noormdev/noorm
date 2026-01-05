# Execution History


Every database operation noorm performs is recorded. When a change runs, a build executes, or files get deployed, that execution goes into the history log with who ran it, when, how long it took, and whether it succeeded.

This gives you an audit trail for compliance, a debugging tool for failures, and a reference for understanding what happened to your database.


## What Gets Tracked

noorm records three types of operations:

| Type | Description | Trigger |
|------|-------------|---------|
| **change** | Change execution | `change run`, `change ff`, `change next` |
| **build** | Full schema rebuild | `run build` |
| **run** | Individual file execution | `run file`, `run directory` |

Each record captures:

- **Name** - Which change, build, or file was executed
- **Direction** - Forward (`change`) or rollback (`revert`)
- **Status** - `success`, `failed`, or `skipped`
- **Who** - The identity that ran it (name and email)
- **When** - Timestamp of execution
- **Duration** - How long it took in milliseconds
- **Checksum** - Hash of the executed files
- **Error** - If failed, what went wrong

File-level details are also preserved. For a change with three SQL files, you can see exactly which file succeeded, which failed, and which were skipped.


## Viewing History in the TUI

Navigate to history from the changes menu. Press `g` from home, then `h` for history.

```
+- Execution History --------------------------------------------+
|                                                                |
|  Total: 47   Changes: 32   Builds: 10   Runs: 5                |
|  Success: 45   Failed: 2                                       |
|                                                                |
|  > [OK]  [CHANGESET] 2025-01-15-add-verification  2 hours ago  |
|    [OK]  [BUILD]     schema-build                 3 hours ago  |
|    [OK]  [CHANGESET] 2025-01-14-add-user-roles    yesterday    |
|    [ERR] [RUN]       seed-data.sql                yesterday    |
|    [OK]  [CHANGESET] 2025-01-10-init-schema       last week    |
|                                                                |
|  +------------------------------------------------------------+|
|  | 2025-01-15-add-verification                                ||
|  | By: Alice <alice@example.com>                              ||
|  | Duration: 1.24s                                            ||
|  | Press Enter to view file details                           ||
|  +------------------------------------------------------------+|
|                                                                |
|  [Enter] View Files   [Esc] Back                               |
+----------------------------------------------------------------+
```

The summary bar shows totals by type. Color-coded status indicators make it easy to spot failures:

- Green `[OK]` - Success
- Red `[ERR]` - Failed
- Yellow `[-]` - Skipped

Arrow keys move through the list. The detail panel at the bottom shows who ran the selected operation and how long it took.


## History Detail View

Press Enter on any record to see file-level execution details:

```
+- File Executions (2025-01-15-add-verification) ----------------+
|                                                                |
|  Total: 3   Success: 2   Failed: 1                             |
|                                                                |
|  > [OK]  001_create-tokens-table.sql     (0.4s)                |
|    [OK]  002_add-user-column.sql         (0.3s)                |
|    [ERR] 003_add-index.sql               (0.5s)                |
|                                                                |
|  +------------------------------------------------------------+|
|  | File Details                                               ||
|  | Path: changes/2025-01-15-.../change/001_create-tokens...   ||
|  | Checksum: 8f4a2b3c9d1e...                                  ||
|  +------------------------------------------------------------+|
|                                                                |
|  [Esc] Back                                                    |
+----------------------------------------------------------------+
```

For failed files, the detail panel shows the error message:

```
|  +------------------------------------------------------------+|
|  | File Details                                               ||
|  | Path: changes/2025-01-15-.../change/003_add-index.sql      ||
|  | Checksum: 3b7c8d2a4f5e...                                  ||
|  | Error: relation "users" does not exist                     ||
|  +------------------------------------------------------------+|
```

This is invaluable for debugging. You can see exactly which file failed, what the error was, and what files succeeded before it.


## Headless Mode

For CI/CD pipelines and scripts, use the headless command:

```bash
noorm -H change history
```

Output:

```
Execution History: 20 records
  2025-01-15-add-verification - success (1/15/2025, 2:30:00 PM)
  schema-build - success (1/15/2025, 11:00:00 AM)
  2025-01-14-add-user-roles - success (1/14/2025, 4:15:00 PM)
```

With JSON output for parsing:

```bash
noorm -H --json change history
```

```json
[
    {
        "name": "2025-01-15-add-verification",
        "status": "success",
        "direction": "change",
        "executedAt": "2025-01-15T14:30:00Z",
        "executedBy": "Alice <alice@example.com>",
        "durationMs": 1240
    },
    {
        "name": "schema-build",
        "status": "success",
        "direction": null,
        "executedAt": "2025-01-15T11:00:00Z",
        "executedBy": "CI Pipeline <ci@company.com>",
        "durationMs": 5830
    }
]
```

Limit the number of records:

```bash
noorm -H change history --count 50
```


## Filtering by Type

The history screen shows all operation types by default. The summary bar helps you understand the distribution:

```
Total: 47   Changes: 32   Builds: 10   Runs: 5
```

Type indicators make scanning easy:

| Indicator | Color | Meaning |
|-----------|-------|---------|
| `[CHANGESET]` | Cyan | Change execution |
| `[BUILD]` | Blue | Full schema rebuild |
| `[RUN]` | Magenta | Individual file execution |

In the list, you can quickly spot operation types by color before reading the name.


## Understanding History Entries

Each history entry tells a complete story. Here's how to read them:


### Who Ran It

The identity shows who executed the operation:

```
By: Alice <alice@example.com>
```

In CI/CD, this might be:

```
By: GitHub Actions <actions@github.com>
```

Identity is captured from git config or explicitly set via `noorm identity`. This creates an audit trail for compliance requirements. You can also set a per-config identity override in [Configs](/guide/environments/configs).


### When It Ran

Timestamps appear in relative format in the TUI:

- `just now` - Within the last minute
- `2 hours ago` - Recent operations
- `yesterday` - Previous day
- `last week` - Within the past week
- `Jan 15` - Specific date for older records

The JSON output provides ISO timestamps for precise filtering and analysis.


### How Long It Took

Duration is shown in seconds:

```
Duration: 1.24s
```

For file-level details, you can see individual file timings:

```
[OK]  001_create-tokens-table.sql     (0.4s)
[OK]  002_add-user-column.sql         (0.3s)
```

This helps identify slow changes or unexpected performance issues.


### What Files Executed

The detail view breaks down each file:

| Status | Icon | Meaning |
|--------|------|---------|
| Success | `[OK]` | File executed without errors |
| Failed | `[ERR]` | Execution threw an error |
| Skipped | `[-]` | File was skipped (unchanged or conditional) |

For skipped files, the skip reason explains why:

```
[-]  setup.sql     - unchanged since last run
```


## Using History for Debugging

When something goes wrong, history is your first stop.


### Finding the Failure

Look for red `[ERR]` indicators in the list. The most recent failure appears near the top.

```
  [ERR] [CHANGESET] 2025-01-16-add-payments  10 minutes ago
```


### Drilling into Details

Press Enter to see which file failed:

```
  [OK]  001_create-table.sql      (0.3s)
  [ERR] 002_add-constraint.sql    (0.1s)
  [-]   003_add-index.sql         - not executed
```

The third file was never executed because the second one failed. This tells you exactly where to start looking.


### Reading the Error

The error message often points directly to the problem:

```
Error: duplicate key value violates unique constraint "users_email_key"
```

Now you know the issue---there's duplicate data that needs cleaning before the constraint can be added.


### Checking Previous Runs

Compare with successful runs of the same change on other environments. Did something change between runs? Did the data differ?

```bash
noorm -H --json change history --count 100 | jq '.[] | select(.name == "2025-01-16-add-payments")'
```


### Recovery Workflow

After fixing the issue:

1. Fix the underlying problem (clean data, modify SQL, etc.)
2. Re-run the change with `--force` if needed
3. Check history to confirm success
4. Continue with `change ff` for remaining changes


## History Retention

History is stored in the noorm tracking tables (`__noorm_change__` and `__noorm_executions__`). These tables grow with usage.

For long-running projects, consider:

- Periodic exports for archival
- Database maintenance to manage table size
- Separate tracking databases for high-volume environments

The history is per-database, per-config. Each configuration maintains its own execution history.


## What's Next?

- [Forward & Revert](/guide/changes/forward-revert) - Applying and rolling back changes
- [Changes](/guide/changes/overview) - Change directory structure and file types
- [Teardown](/guide/database/teardown) - What happens to history after teardown

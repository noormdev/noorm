# Forward and Revert Lifecycle


Database changes move in two directions: forward when you apply them, backward when you need to undo. Understanding this lifecycle helps you deploy with confidence and recover gracefully when things go wrong.


## Applying Changes

noorm provides three ways to apply changes, each suited to different situations.


### Fast-Forward All Pending

Apply every pending change in chronological order:

**TUI:** Navigate to Changes (`g` from home), then press `f` for fast-forward.

**Headless:**
```bash
noorm change ff
noorm change ff --json
```

Fast-forward is the workhorse for deployments. It finds every outstanding change (`pending`, `reverted`, or `stale` after a teardown), sorts them by folder name so the `YYYY-MM-DD` prefix puts them in chronological order, and executes each one in sequence. If any change fails, execution stops immediately.

**JSON output:**
```json
{
    "success": true,
    "status": "success",
    "executed": 2,
    "skipped": 0,
    "failed": 0,
    "durationMs": 77,
    "changes": [
        {"name": "2024-02-01-add-notifications", "direction": "change", "status": "success", "durationMs": 45},
        {"name": "2024-02-15-user-preferences", "direction": "change", "status": "success", "durationMs": 32}
    ]
}
```

Each entry in `changes` also carries a `files` array with one record per SQL file: relative path, checksum, status, duration, and the error message when the file failed. If the `changes/` directory is missing, the payload gains a `warnings` array saying so, because an absent directory otherwise looks identical to an up-to-date database.


### Apply a Specific Change

Run one change by name:

**TUI:** From the Changes list, select a change and press `r` for run.

**Headless:**
```bash
noorm change run 2024-02-01-add-notifications
```

This is useful when you need to apply changes out of order during development, or re-run a failed change after fixing the underlying issue.


### Apply the Next Pending Change

Apply only the next change in sequence:

**TUI:** From Changes, press `n` for next.

**Headless:**
```bash
noorm change next
```

Useful for stepping through changes one at a time, perhaps while monitoring system behavior between each.


## Reverting Changes

Rolling back requires that your change includes revert scripts in its `revert/` folder.


### Revert a Specific Change

Undo one change:

**TUI:** From Changes, select an applied change and press `v` for revert.

**Headless:**
```bash
noorm change revert 2024-02-01-add-notifications
```

Revert scripts execute in forward sequence order, just like change scripts. You design them to undo in reverse—if your change had `001_create-table.sql` and `002_add-indexes.sql`, your revert should have `001_drop-indexes.sql` (undoes the last thing) and `002_drop-table.sql` (undoes the first thing).


### Rewind Multiple Changes

Revert the last N applied changes:

**TUI:** From Changes, press `w` for rewind, then specify how many.

**Headless:**
```bash
noorm change rewind 3
```

Rewind walks through your applied changes starting with the newest, reverting each one before moving to the next oldest. It considers only changes currently recorded as `success`, and orders them by when they were applied. Changes applied in the same second, which is everything a single `change ff` applies, tie on that timestamp, so the tracking table's row id breaks the tie and preserves true apply order.

Pass a change name instead of a count to rewind back to and including that change:

```bash
noorm change rewind 2024-02-01-add-notifications
```


## What Happens During Apply

When you apply a change, noorm:

1. **Reads the change folder** - Loads all files from `change/` and determines their types (`.sql`, `.sql.tmpl`, or `.txt` manifest).

2. **Calculates a checksum** - Creates a combined hash of all files to detect future modifications.

3. **Checks the database record** - Looks up this change's status to determine if it should run.

4. **Acquires the config lock** - Stops a second operation on the same config from running concurrently. The lock is released when the change finishes, whatever the outcome.

5. **Resolves manifest references** - For `.txt` files, replaces file references with actual SQL content from your schema directory.

6. **Processes templates** - For `.sql.tmpl` files, runs them through the Eta templating engine.

7. **Executes SQL in sequence** - Runs each file in order (`001_`, `002_`, etc.) against the database. A file whose checksum matches a still-standing success from an earlier attempt is skipped, so a retry only re-runs what actually needs re-running.

8. **Records the result** - Stores the execution status, checksum, and timestamp in the change tracking tables.

If any file fails, execution stops, and the files that were never reached are recorded as skipped. On PostgreSQL the whole change runs inside one transaction, so the failure rolls back the DDL and the history rows together and the change leaves no record at all. On MySQL, SQL Server, and SQLite there is no wrapping transaction: whatever already committed stays committed, and the change is recorded as `failed`.


## What Happens During Revert

Reverting follows a similar process but with key differences:

1. **Verifies the change can be reverted** - A change recorded as `success` or `failed` can be reverted. One that was never applied, is already `reverted`, or went `stale` after a teardown cannot. `--force` skips this check.

2. **Reads the revert folder** - Loads files from `revert/` instead of `change/`.

3. **Executes in sequence order** - Files run from lowest to highest (`001_`, `002_`, etc.), same as change scripts.

4. **Updates the records** - Writes its own history record with direction `revert`, then flips the original forward record's status to `reverted`. The revert record's timestamp is what surfaces as `revertedAt`.

After reverting, the change returns to a state where it can be applied again. This is the `reverted` status, which noorm treats as "needs to run" during the next fast-forward.


## Dry Run Mode

Preview what would happen without touching the database:

**TUI:** Press `Shift+D` to turn on dry-run mode. It is a global toggle, so every apply and revert stays a dry run until you press it again.

**Headless:**

    noorm change ff --dry-run
    noorm change run 2024-02-01-add-notifications --dry-run
    noorm change revert 2024-02-01-add-notifications --dry-run
    noorm change next --dry-run
    noorm change rewind 3 --dry-run

Dry run writes rendered SQL to a `tmp/` folder so you can inspect exactly what would execute. Templates are processed and manifests are resolved, but nothing from your change files runs against the database and nothing is written to the change tracking tables: the dry-run path skips the status lookup, takes no lock, and creates no history record. `ff`, `next`, and `rewind` still read the tracking tables to decide which changes to render.

In human mode the CLI opens with `Dry run: rendering changes to tmp/ (no DB writes)`, labels the summary line `(dry-run)`, and tags each change `dry-run`, so log scrapers and operators can tell it apart from a real apply. With `--json` those lines are suppressed and the result payload carries a `dryRun: true` field instead (`rewind --json` is the exception and omits it):

    $ noorm change ff --dry-run --json
    {
      "success": true,
      "status": "success",
      "executed": 2,
      "skipped": 0,
      "failed": 0,
      "durationMs": 12,
      "changes": [],
      "dryRun": true
    }

This is essential for production deployments. Always preview before applying.


## Handling Failures

When a change fails:

1. **Execution stops immediately** - No further files in the change execute. The ones never reached are recorded as `skipped`, with the failing file named as the reason.

2. **Status is recorded as failed** - The change shows `failed` in the list.

3. **Error details are captured** - The failing file name and the database's error message are stored on both the change record and that file's record.

4. **Next fast-forward will retry** - Failed changes are outstanding work, so the next `ff` attempt includes them.

On PostgreSQL, steps 2 and 3 do not survive the failure. The change runs inside one transaction, DDL and history rows alike, so a failure rolls all of it back and leaves no record behind. You still see the error in the command's output and exit code, and the next `ff` reruns the change because the tracking tables show it as never applied. MySQL, SQL Server, and SQLite have no wrapping transaction and keep the `failed` record.


### Investigating Failures

**TUI:** From Changes, press `h` for history, then select the failed operation to see file-level details.

**Headless:**
```bash
noorm change history
```

The history shows which specific file failed and includes the error message from the database. On PostgreSQL there is nothing to show, since a failed change rolls its history rows back with the DDL; read the error off the failing command instead. See [History](/guide/changes/history) for detailed debugging workflows.


### Recovering from Failures

Option 1: **Fix and retry**
- Edit the SQL file to fix the issue
- Run `change ff` again (the change will be picked up automatically)

Option 2: **Manual cleanup**
- If partial SQL executed, you may need to manually clean up
- Then run with `--force` to skip the checksum check:

        noorm change run 2024-02-01-add-notifications --force


## Common Workflows


### Deploying to Production

    # Preview what will run
    noorm change ff --dry-run

    # Review the rendered SQL in tmp/
    # Then apply for real
    noorm change ff


### Rolling Back a Bad Deploy

```bash
# See current state
noorm change list

# Revert the problematic change
noorm change revert 2024-02-15-broken-change
```


### Starting Fresh After Teardown

After running `db teardown`, all changes are marked as `stale`. The next fast-forward re-applies everything:

```bash
noorm db teardown -y
noorm run build      # Rebuild base schema
noorm change ff      # Re-apply all changes
```


### Testing Revert Scripts

During development, verify your revert logic works:

```bash
# Apply the change
noorm change run 2024-02-01-add-notifications

# Revert it
noorm change revert 2024-02-01-add-notifications

# Apply again to confirm round-trip works
noorm change run 2024-02-01-add-notifications
```

This apply-revert-apply cycle catches revert scripts that are missing steps or have incorrect SQL.


### CI/CD Pipeline

A typical deployment script:

```bash
#!/bin/bash
set -e

# Build base schema (idempotent)
noorm run build

# Apply pending changes
noorm change ff

# Verify the result
noorm db explore --json
```

The build step handles the initial schema. The fast-forward applies any changes that have been merged since the last deploy.


## What's Next?

- [History](/guide/changes/history) - Track and debug execution history
- [Changes](/guide/changes/overview) - Change structure and file types
- [Teardown](/guide/database/teardown) - How teardown affects change status

# Forward and Revert Lifecycle


Database changes move in two directions: forward when you apply them, backward when you need to undo. Understanding this lifecycle helps you deploy with confidence and recover gracefully when things go wrong.


## Applying Changes

noorm provides three ways to apply changes, each suited to different situations.


### Fast-Forward All Pending

Apply every pending change in chronological order:

**TUI:** Navigate to Changes (`g` from home), then press `f` for fast-forward.

**Headless:**
```bash
noorm -H change ff
noorm -H --json change ff
```

Fast-forward is the workhorse for deployments. It finds all unapplied changes, sorts them by date, and executes each one in sequence. If any change fails, execution stops immediately.

**JSON output:**
```json
{
    "status": "success",
    "applied": 2,
    "skipped": 0,
    "failed": 0,
    "changes": [
        {"name": "2024-02-01-add-notifications", "status": "success", "durationMs": 45},
        {"name": "2024-02-15-user-preferences", "status": "success", "durationMs": 32}
    ]
}
```


### Apply a Specific Change

Run one change by name:

**TUI:** From the Changes list, select a change and press `r` for run.

**Headless:**
```bash
noorm -H change run 2024-02-01-add-notifications
```

This is useful when you need to apply changes out of order during development, or re-run a failed change after fixing the underlying issue.


### Apply the Next Pending Change

Apply only the next change in sequence:

**TUI:** From Changes, press `n` for next.

**Headless:**
```bash
noorm -H change next
```

Useful for stepping through changes one at a time, perhaps while monitoring system behavior between each.


## Reverting Changes

Rolling back requires that your change includes revert scripts in its `revert/` folder.


### Revert a Specific Change

Undo one change:

**TUI:** From Changes, select an applied change and press `v` for revert.

**Headless:**
```bash
noorm -H change revert 2024-02-01-add-notifications
```

Revert scripts execute in forward sequence order, just like change scripts. You design them to undo in reverse—if your change had `001_create-table.sql` and `002_add-indexes.sql`, your revert should have `001_drop-indexes.sql` (undoes the last thing) and `002_drop-table.sql` (undoes the first thing).


### Rewind Multiple Changes

Revert the last N applied changes:

**TUI:** From Changes, press `w` for rewind, then specify how many.

**Headless:**
```bash
noorm -H change rewind 3
```

Rewind walks through your applied changes starting with the newest, reverting each one before moving to the next oldest.


## What Happens During Apply

When you apply a change, noorm:

1. **Reads the change folder** - Loads all files from `change/` and determines their types (`.sql`, `.sql.tmpl`, or `.txt` manifest).

2. **Calculates a checksum** - Creates a combined hash of all files to detect future modifications.

3. **Checks the database record** - Looks up this change's status to determine if it should run.

4. **Resolves manifest references** - For `.txt` files, replaces file references with actual SQL content from your schema directory.

5. **Processes templates** - For `.sql.tmpl` files, runs them through the Eta templating engine.

6. **Executes SQL in sequence** - Runs each file in order (`001_`, `002_`, etc.) against the database.

7. **Records the result** - Stores the execution status, checksum, and timestamp in the tracking table.

If any file fails, execution stops. The change is marked as `failed`, and subsequent files in that change are not executed.


## What Happens During Revert

Reverting follows a similar process but with key differences:

1. **Verifies the change is applied** - You cannot revert a change that was never applied or has already been reverted.

2. **Reads the revert folder** - Loads files from `revert/` instead of `change/`.

3. **Executes in sequence order** - Files run from lowest to highest (`001_`, `002_`, etc.), same as change scripts.

4. **Updates the record** - Marks the change as `reverted` with a timestamp.

After reverting, the change returns to a state where it can be applied again. This is the `reverted` status, which noorm treats as "needs to run" during the next fast-forward.


## Dry Run Mode

Preview what would happen without touching the database:

**TUI:** In any run dialog, enable the dry-run toggle before confirming.

**Headless:**
```bash
noorm -H --dry-run change ff
noorm -H --dry-run change run 2024-02-01-add-notifications
```

Dry run writes rendered SQL to a `tmp/` folder so you can inspect exactly what would execute. Templates are processed, manifests are resolved, but no SQL hits the database.

This is essential for production deployments. Always preview before applying.


## Handling Failures

When a change fails:

1. **Execution stops immediately** - No further files in the change execute.

2. **Status is recorded as failed** - The change shows `failed` in the list.

3. **Error details are captured** - The specific error message is stored for debugging.

4. **Next fast-forward will retry** - Failed changes are automatically included in the next `ff` attempt.


### Investigating Failures

**TUI:** From Changes, press `h` for history, then select the failed operation to see file-level details.

**Headless:**
```bash
noorm -H change history
```

The history shows which specific file failed and includes the error message from the database. See [History](/guide/changes/history) for detailed debugging workflows.


### Recovering from Failures

Option 1: **Fix and retry**
- Edit the SQL file to fix the issue
- Run `change ff` again (the change will be picked up automatically)

Option 2: **Manual cleanup**
- If partial SQL executed, you may need to manually clean up
- Then run with `--force` to skip the checksum check:
  ```bash
  noorm -H --force change run 2024-02-01-add-notifications
  ```


## Common Workflows


### Deploying to Production

```bash
# Preview what will run
noorm -H --dry-run change ff

# Review the rendered SQL in tmp/
# Then apply for real
noorm -H change ff
```


### Rolling Back a Bad Deploy

```bash
# See current state
noorm -H change

# Revert the problematic change
noorm -H change revert 2024-02-15-broken-change
```


### Starting Fresh After Teardown

After running `db teardown`, all changes are marked as `stale`. The next fast-forward re-applies everything:

```bash
noorm -H -y db teardown
noorm -H run build      # Rebuild base schema
noorm -H change ff      # Re-apply all changes
```


### Testing Revert Scripts

During development, verify your revert logic works:

```bash
# Apply the change
noorm -H change run 2024-02-01-add-notifications

# Revert it
noorm -H change revert 2024-02-01-add-notifications

# Apply again to confirm round-trip works
noorm -H change run 2024-02-01-add-notifications
```

This apply-revert-apply cycle catches revert scripts that are missing steps or have incorrect SQL.


### CI/CD Pipeline

A typical deployment script:

```bash
#!/bin/bash
set -e

# Build base schema (idempotent)
noorm -H run build

# Apply pending changes
noorm -H change ff

# Verify the result
noorm -H --json db explore
```

The build step handles the initial schema. The fast-forward applies any changes that have been merged since the last deploy.


## What's Next?

- [History](/guide/changes/history) - Track and debug execution history
- [Changes](/guide/changes/overview) - Change structure and file types
- [Teardown](/guide/database/teardown) - How teardown affects change status

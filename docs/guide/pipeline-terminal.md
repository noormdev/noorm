# Pipelines in the terminal

Use the native pipeline screens to review a SQL workflow, supply typed inputs, run it against the active config, and inspect its recorded outcomes. Definitions remain code-owned files; create them with the [SQL pipelines guide](/guide/sql-pipelines).

```bash
noorm ui
```

From Home, press `p`, highlight a pipeline, and press `Enter` to review it. For a validation pass, press uppercase `D`, check that **Next invocation** says **dry run**, and press `r` to open confirmation. Complete the dialog to validate and render without executing workflow SQL or writing pipeline history.

![Supplying a reporting month, inspecting steps, previewing a dry run, and committing a monthly close](/image/pipeline-run.gif)

## Review the definition

The list discovers `pipeline.yml` files under `paths.pipelines` (default `./db/pipelines`). An invalid definition stays in the list with the rule it failed, such as `Invalid definition (yaml)`, and cannot run. The [rule table](/cli/pipeline#error-messages) says what each rule checks. You can browse definitions and edit inputs before a database connection is ready; execution and history need a ready active config.

Review shows the ordering mode (`linear` or `graph`), transaction policy, single-run protection, and configured and effective concurrency. Effective concurrency can be lower than the declaration: SQLite, linear workflows, and whole-pipeline transactions run serially.

| Key in review | Action |
|---|---|
| `↑` `↓` | Highlight an input or step |
| `Enter` | Open one input form, or inspect the highlighted step |
| `x` | Reset the highlighted input override |
| `s` | Switch between inputs and steps |
| `d` | Read the input description, definition description, or current error |
| `r` | Confirm the next run or dry run |
| `h` | Open history for this slug |
| `Esc` | Back |

Steps appear in declaration order, with their prerequisite declaration numbers. Open a step to read its full name and dependencies when the list truncates them. Declaration order identifies steps; a graph's dependencies determine which steps can execute.

Step inspection preserves the highlighted row and visible list position in review, settled results and recorded history. Closing metadata, cancelling lookup or refreshing the same run also keeps your place; a different pipeline, run or database configuration starts a new selection.

Headings and summary rows stay on one terminal line. Press `d` in review, results, history or run detail to inspect the full pipeline slug and metadata.

## Save inputs explicitly

Each input row shows presence rather than its value:

| Badge | Meaning | After `x` Reset |
|---|---|---|
| `Supplied` | You saved an override for this invocation draft | Remove the override and use the declaration's default or absence |
| `Default` | No override; the declared default will apply | Remain `Default` |
| `Omitted` | Optional, with no override or default; the property stays absent | Remain `Omitted` |
| `Unset` | Required, with no override or default | Remain `Unset`; supply it before running |

Highlight an input and press `Enter` to open its one-field form. Saving is a separate action from editing:

1. For text or a choice, press `Enter` on the field to edit it.
2. Enter the value or select an option. Press `Enter` to commit the field and return to browse mode.
3. Press `↓` to reach the action row, select **Save**, and press `Enter`.

A checkbox toggles in place with `Enter` or `Space`. Leave it unchecked and activate **Save** to supply `false`. For a value that already appears in the form, including a default or the first choice, you can go directly to **Save**.

Opening an editor does not supply a value. **Cancel**, or `Esc` in browse mode, preserves the previous override or absence. In edit mode, `Esc` restores the field's previous value and returns to browse; it does not save the input. Back in review, `x` deletes the saved override rather than saving an empty replacement.

| Declared type | Enter or select |
|---|---|
| `string` | Literal text, including the empty string |
| `number` | A finite number, including `0` |
| `integer` | A safe whole number, including `0` |
| `boolean` | A checkbox; unchecked saves `false` |
| Scalar `choices` | A typed choice, not its display text; `""`, `0`, and `false` remain distinct values |
| `object` | JSON such as `{"balanced":false,"count":0}` |
| `array` | JSON such as `[0,false,""]` |

**Required means present, not nonempty.** Saving an empty required string supplies a valid string. Saving `false` or `0` supplies a value too. A default satisfies required presence without an override. Run validation reports missing required inputs together; it does not silently turn omitted values into empty strings or unchecked booleans.

Input edits are a screen draft, not changes to `pipeline.yml`. They are not stored as reusable presets in history.

## Confirm the target and mode

Uppercase `D` changes the **next invocation** between execute and dry run. Press `r` to validate saved input and open the native confirmation dialog. Both modes enforce the active config's `pipeline:run` policy, including protected-config confirmation when required.

The dialog captures the database target, mode, and input draft. A target change invalidates the confirmation and requires fresh review. Once started, the operation keeps its captured target and mode; later global mode changes do not redirect it. Duplicate starts are rejected.

Uppercase `F` has **no pipeline effect**. It does not bypass policy, single-run protection, or transaction behavior. Each admitted invocation starts the workflow fresh and receives a new run ID; history is not an applied-state gate.

Dry run validates and renders all steps without workflow SQL, a single-run guard, or pipeline-run history. Trusted template helpers can still have side effects. It is not a database rollback simulation or a general SQL syntax check.

## Read the settled result

While busy, the screen shows a spinner and elapsed time. It does not stream step progress, SQL, or query rowsets. When the operation settles, review the run ID, execution status, transaction outcome, and declaration-ordered steps.

| Key on a result | Action |
|---|---|
| `Enter` | Inspect the highlighted step's status, outcome, and dependencies |
| `d` | Inspect run evidence and error phases |
| `r` | Return to review; this does not rerun by itself |
| `h` | Open scoped history |
| `Esc` | Back |

Execution status and transaction outcome answer different questions:

| Evidence | Interpretation |
|---|---|
| A step executed successfully, then shows `rolled_back` | SQL completed, but a later rollback undid its transaction |
| `partial` with confirmed earlier commits | Some committed work survives; do not assume a rerun is safe |
| `unknown` | noorm cannot prove the outcome; a disconnect is not proof of rollback |
| `skipped` / `not_started` | The step was not attempted |
| Dry run with no run ID | Preparation completed without admission or workflow SQL |

A separate connection-cleanup warning means the operation did not finish cleanly even if its core result reports a confirmed commit. That warning does not relabel a known commit as unknown or erase the run ID and execution evidence. Inspect the result and scoped history before deciding whether to invoke the workflow again. Cleanup failure also preserves a nonzero managed exit status.

The screens show safe identifiers, statuses, dependency numbers, and error phases rather than arbitrary exception text, absolute paths, guard keys, raw input, or rendered SQL. The input editor necessarily displays the value you are editing. History stores checksums instead of input values and rendered SQL, so it cannot reconstruct an input draft.

## Look up history without a definition

From the pipeline list, `h` opens the highlighted slug's history, or a slug lookup when nothing is selected. `i` opens run-ID lookup directly. Neither lookup requires the definition to remain on disk, so removed or invalid definitions do not hide recorded runs.

The recording compares a December whole-pipeline rollback with a November step-policy failure whose earlier cache update remains committed.

![Inspecting rolled-back, skipped and committed steps, refreshing history, and looking up another run](/image/pipeline-history.gif)

| Screen | Key | Action |
|---|---|---|
| History | `Enter` | Open the highlighted run |
| History | `h` | Edit slug and limit |
| History | `i` | Look up a run ID |
| History | `r` | Refresh |
| Run detail | `Enter` | Inspect a step |
| Run detail | `i` | Look up another run ID |
| Run detail | `r` | Refresh |
| Either | `d` | Inspect the full pipeline slug and metadata |
| Either | `Esc` | Back |

Slug lookup defaults to **20** runs and accepts a whole-number limit from **1 through 100**. Runs appear newest ID first; steps remain in declaration order. Run-ID lookup accepts a positive safe whole number.

Reads use the current active config. A run in another config is not found, even if you know its ID. Loading is not evidence of an empty history or a missing run. History can lag while workflow execution and bookkeeping settle; use `r` to refresh rather than interpreting a pending record as a final commit or rollback.

## Stop and quit without assuming rollback

During an operation, `Esc` requests stop. noorm stops scheduling new steps and waits for already-running SQL, transaction settlement, and bookkeeping. This is not a server-side statement-kill command, on any dialect. The busy screen says that it is waiting for running SQL and transaction cleanup.

Navigation, config changes, and quit do not transfer an active operation to a new connection or discard its completion work. The operation retains its original connection until settlement and release. Quit enters managed shutdown, which requests stop before completing tasks and releasing connections.

Connections retired after a run has finished are still awaited during managed release. A disposal failure preserves the recorded execution evidence and makes managed exit nonzero; it does not rewrite pipeline history.

Shutdown has a bounded completing phase with a shared budget (30 seconds by default). If that budget expires, or you press `Ctrl+C` again to force exit, shutdown is incomplete and exits nonzero. Running SQL may continue. Neither a timeout nor force proves rollback, releases an uncertain protected guard, or manufactures final history.

For an abandoned protected run, follow [pipeline recovery](/guide/pipeline-recovery). An administrator must establish that database activity has settled before clearing ownership. There is no automatic retry, resume, guard expiry, or force-unlock action in these screens.

## Related guides

- [SQL pipelines](/guide/sql-pipelines): author definitions, dependencies, templates, and transaction boundaries.
- [Pipeline CLI](/cli/pipeline): scripted run, history, and run-ID lookup.
- [Terminal UI](/tui): shared forms, navigation, and global keys.

The terminal screens add no YAML editor, visual graph editor, progress stream, or database tables beyond the existing pipeline history model.

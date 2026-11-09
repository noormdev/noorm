# `noorm pipeline`

Run a named SQL workflow and inspect its config-scoped history. Define the workflow first as described in [SQL pipelines](/guide/sql-pipelines).

```bash
noorm --cwd /path/to/project pipeline run close-period --input '{"period":"2026-10","batchSize":5}' --batch-size 0 --dry-accounting=false
noorm --cwd /path/to/project pipeline history close-period --limit 20
noorm --cwd /path/to/project pipeline show 1
```

Place the global `--cwd` before `pipeline`. Put operation flags after the slug or subcommand. In this example `--batch-size 0` overrides the JSON value, and `false` and `0` remain typed values.

For native review, typed input forms, confirmation, and history lookup, see [Pipelines in the terminal](/guide/pipeline-terminal).

## Run

```text
noorm pipeline run <slug> [--input <json>] [generated input flags] [--dry-run] [--config <name>] [--yes] [--json]
```

`run` requires one slug. The explicit command keeps workflow names independent of CLI commands: `noorm pipeline run history` executes the workflow named `history`. Bare-slug execution is not supported.

Use `noorm pipeline --help` to list the static `run`, `history`, and `show` commands, or `noorm pipeline run --help` to see the required slug positional. Neither loads a manifest, settings, secrets, or a database connection.

`--input` must be a JSON object. Each declared lowerCamelCase input produces a kebab-case flag. Explicit flags override JSON properties, then defaults fill absent values. Boolean flags accept `--flag=true` and `--flag=false`; object and array flags take JSON. Use `noorm pipeline run <slug> --help` to see that definition's descriptions, types, required fields, defaults, and choices. Definition-specific help reads the selected manifest offline without loading secrets, rendering SQL, or connecting.

Missing required values prompt only when stdin and stdout are terminals and the invocation is not CI, JSON, `--yes`, `NOORM_YES`, or the agent channel. Otherwise supply every required value. Invalid explicit values and cancelled prompts stop before admission. Input flag names cannot collide with built-in flags.

`--dry-run` validates and renders all declarations without creating history, claiming a guard, or executing workflow SQL. Trusted template helpers can still have side effects. Both normal and dry runs enforce `pipeline:run` access policy. `pipeline history` and `pipeline show <run-id>` read through `explore`, which gates the agent channel only.

## History and show

```text
noorm pipeline history <slug> [--limit <number>] [--config <name>] [--json]
noorm pipeline show <run-id> [--config <name>] [--json]
```

History defaults to 20 runs and accepts an integer from 1 through 100. It lists newest run IDs first. Show requires a positive safe integer and returns the run with declaration-ordered steps. Both commands use the selected config; a run in another config is not found.

Input values and rendered SQL are not included in ordinary output or stored in pipeline history. History may lag execution while workflow activity settles. A protected run can retain its guard when activity is uncertain; use [pipeline recovery](/guide/pipeline-recovery), not an automatic retry or force unlock.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, dry run, or help. |
| `1` | Failure, busy, blocked by policy, a run ID that does not exist, or unknown outcome without confirmed partial committed work. |
| `2` | Invalid definition, input, or invocation, including an unknown pipeline. |
| `3` | Confirmed partial committed work. Inspect history before deciding what to do next. |
| `130` | A second Ctrl+C. The process exits without waiting for the run to settle. |

The first Ctrl+C aborts the run and the command waits for it to settle. The second exits `130` at once. Running SQL may continue on the server, and history may not have settled, so check [pipeline recovery](/guide/pipeline-recovery) before retrying.

## Error messages

The messages in this table can name inputs, never their values, and never include rendered SQL, paths, or database error text.

| Message | Exit | Cause |
|---|---|---|
| `Pipeline not found` | `2` | The slug names no pipeline folder under `paths.pipelines`. |
| `Invalid pipeline definition (<rule>)` | `2` | The manifest or a step failed the named rule. |
| `Invalid pipeline definition or invocation` | `2` | A command that loads a definition failed for a reason that is not a named rule or an unknown slug. |
| `Invalid or cancelled pipeline input or invocation` | `2` | `run` rejected an argument or the interactive input prompt was cancelled. |
| `Missing required pipeline inputs: <names>` | `2` | A non-interactive `run` lacks required inputs. The message lists their names. |
| `Invalid pipeline input` | `2` | The SDK rejected input the CLI accepted. |
| `Invalid pipeline run ID or invocation` | `2` | `show` got a bad run ID or argument. |
| `Invalid pipeline history invocation` | `2` | `history` got a bad limit or argument. |
| `Unable to read pipeline history` | `1` | `history` could not read the run table. |
| `Pipeline execution failed` | `1` | Any other failure during a run. |
| `Pipeline run not found` | `1` | `show` found no such run ID in the selected config. |
| `Pipeline execution is blocked by the config policy or requires confirmation; pass --yes` | `1` | A protected config blocks the run, or it needs confirmation. |
| `Pipeline execution is blocked by the config policy` | `1` | The same, when `--yes` was already passed. Confirmation cannot lift it. |
| `Pipeline execution was not admitted` | `1` | A `singleRun` pipeline already has an active run. |

Some failures exit `1` with the driver's message, which may not be safe to publish: `Failed to create context: …`, `Failed to connect: …` and `Failed to initialize database schema: …` for connection, context and schema-version failures, and any database error thrown while `show` or `history` reads the run tables.

`<rule>` is one of:

| Rule | Failed check |
|---|---|
| `slug`, `pipelines-path` | The slug or the configured `paths.pipelines` is not a safe relative name. |
| `missing-directory`, `missing-file` | `missing-directory`: the configured `paths.pipelines` root does not exist. `missing-file`: the manifest or a step SQL file does not exist. |
| `unreadable-path`, `path-kind`, `path-escape` | A path cannot be read, is the wrong kind, or resolves outside its directory. |
| `yaml`, `manifest-schema` | The manifest is not valid YAML, or does not match the manifest schema. |
| `input-name`, `input-default`, `input-choices`, `input-default-choice` | An input name, default, or choice list is invalid. |
| `mixed-dependencies`, `duplicate-step`, `step-dependency`, `dependency-cycle` | Steps mix linear and graph styles, repeat an ID, name a bad dependency, or form a cycle. |
| `step-sql-path` | A step SQL path is unsafe or not a `.sql` or `.sql.tmpl` file. |
| `step-prepare` | A step failed to render. |
| `escape-unavailable` | A step template called `$.escape`, which pipelines do not support. Use `$.quote`. |
| `transaction-control` | A step contains transaction control or an implicit commit under managed transactions. A PostgreSQL `BEGIN ATOMIC ... END` body is rejected too, because its `END` cannot be told from a transaction end. |

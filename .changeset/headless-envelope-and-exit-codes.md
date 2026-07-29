---
"@noormdev/cli": major
"@noormdev/sdk": major
---

## Headless contract: one `--json` envelope, four exit codes

### Changed

* `fix(cli)!:` every `--json` payload is now a JSON **object** carrying a top-level boolean `success`, and is never a bare array. `success` is `true` if and only if the process exits `0`, so `jq -e '.success'` is a failure check that works against every command.
  * **Commands that returned a top-level array now return a named object.** `change list` → `.changes` (plus `.pending`), `change history` → `.history`, and every `db explore` list — `tables`, `views`, `indexes`, `fks` (→ `.foreignKeys`), `functions`, `procedures`, `types`, `triggers` — under the matching key. A script doing `jq '.[]'` on any of those must now name the key.
  * **Every other payload gained `success` and lost nothing.** Existing key reads keep working.
  * `config export --json` now emits the envelope (`{success, name, config}`). The bare artifact — the shape `config import` reads — is still what `noorm config export dev > dev.json` produces, unchanged.
  * `noorm update --json` no longer prints two JSON documents for one error, and no longer reports `success: true` on a failed install while exiting non-zero.
* `fix(cli)!:` exit codes now distinguish four outcomes: `0` success, `1` total failure, `2` usage error (bad or missing flag, a TTY-only command run non-interactively, or a named target that does not exist), `3` partial failure.
  * **`2` no longer means "partial".** It previously meant partial failure on `run build` / `run dir` / `run files` / `run exec` and the five `change` execution commands — but the same `2` was also returned for a *total* failure on those commands, so the two were indistinguishable. Partial now has its own code. **A pipeline testing `[ $? -eq 2 ]` for "partially applied" must now test `-eq 3`.** Checks of the form `if ! noorm …` are unaffected.
  * `ci secrets` partial loads move from `2` to `3`. `db transfer`'s total-failure exit moves from `2` to `1` (its partial exit stays `3`). `vault propagate` and `vault rm`, `dev test-workers` and `dev test-helpers` now report partial and not-found instead of collapsing everything to `1`.
  * A "you named something that isn't there" failure — missing file, directory, config, change, secret key, table, or a glob matching nothing — moves from `1` to `2` across the CLI. Confirmation and `--force` refusals deliberately stay at `1`.

### Fixed

* `noorm run inspect <missing-file>` reported a fully-populated context and exit `0` for a file that was never on disk — it only ever read the template's *directory*. It now fails with exit `2`. `run preview` gained the same up-front check so both surfaces agree.
* `noorm run dir` reported success over a directory that contained no SQL files, and reported a missing directory as a SQL failure. Both now exit `2` with a message naming the path.
* `noorm run exec` died with `Bun is not defined` under Node — the documented dev entry point — before doing any work. Glob expansion falls back to `node:fs/promises` when the `Bun` global is absent; the compiled binary keeps Bun's own matcher.
* `noorm run preview --json` put a full stack trace, including absolute filesystem paths, into the machine-readable `error` field. `--json` now carries the message only; the stack still reaches an operator on stderr.
* `noorm lock acquire` gained `--timeout` and `--reason`, which the TUI has always collected — CI-acquired locks were permanently default-timeout and reasonless, so whoever they blocked had no way to see what they were waiting on.
* `withVaultContext` never passed `yes` to the SDK context, so `--yes` / `NOORM_YES` was inert for every vault command.
* `db transfer` declared a `--force` flag that nothing read.
* `run exec`, `db reset`, `vault cp`, and `dev test-helpers` wrote some errors straight to stderr, leaving `--json` callers with an empty stdout and no envelope to parse.

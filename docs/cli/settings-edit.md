# noorm settings edit


Interactive editor for `settings.yml` — paths, build rules, strict mode,
logging, stages, conditional rules, teardown.


## Environment

Interactive TTY required. Fails with exit code 2 (usage error) in CI or piped stdin.

`settings.yml` is plain YAML, so `--yes` / `NOORM_YES` has no useful
non-interactive path here. Both produce a redirect hint pointing you at
direct YAML edits, with `noorm settings build` available afterwards to
re-validate and apply defaults. See
[Non-interactive operation](../guide/automation/non-interactive.md).


## Example

    noorm settings edit

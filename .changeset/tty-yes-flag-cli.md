---
"@noormdev/cli": minor
---

## Added
* `feat(cli):` Universal `--yes` / `-y` flag and `NOORM_YES=1` environment variable for TTY-gated commands. Unblocks CI, scripted bootstrap, and subagent flows.
* `feat(cli):` `noorm init --yes` now succeeds in non-TTY environments when an identity already exists at `~/.noorm/identity.{key,pub,json}`. Without an identity, it errors with a hint pointing at `noorm identity init --name "X" --email "Y"`.
* `feat(cli):` `noorm sql repl --yes`, `noorm settings edit --yes`, and `noorm settings secret --yes` print a documented redirect-hint error instead of refusing silently, telling the user which non-interactive alternative to use (`sql query` / direct YAML edit / `secret set`).

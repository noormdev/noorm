# noorm settings secret


Interactive editor for the secret *requirement* declarations in
`settings.yml`. Manages which secrets each stage requires — not the
actual values.

For secret values, see [`noorm secret set`](./secret.md).


## Environment

Interactive TTY required. Fails with exit code 2 (usage error) in CI or piped stdin.

`--yes` / `NOORM_YES` produces a redirect hint here — the requirement
list lives directly in `settings.yml`, so editing the YAML by hand is the
non-interactive path. Use `noorm secret set <key> <value>` for values.
See [Non-interactive operation](../guide/automation/non-interactive.md).


## Example

    noorm settings secret

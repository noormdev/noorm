# noorm secret


Store a secret on one config, encrypted on your machine and shared with no one.

```bash
printf %s "$GATEWAY_KEY" | noorm secret set PAYMENT_GATEWAY_KEY --stdin --config prod
noorm secret list --config prod
```

```
Secret "PAYMENT_GATEWAY_KEY" set for config "prod".
Secrets for "prod" (1):
  PAYMENT_GATEWAY_KEY
```

The value lands in `.noorm/state/state.enc`. `list` shows keys only. A template reads it as `$.secrets.PAYMENT_GATEWAY_KEY`.


## Where should a secret live?


A template takes the first tier that holds the key: config, then global, then vault. A miss throws `Secret "KEY" not found (searched: config-local, global-local, vault)`.

| Tier | Stored in | Set with | Shared with the team |
|------|-----------|----------|----------------------|
| Config | `.noorm/state/state.enc`, per config | `noorm secret set`, or the TUI (`c`, highlight a config, `k`) | No. Per user, per machine |
| Global | `state.enc`, all your configs | No CLI or TUI command writes one | No |
| Vault | The database, encrypted | [`noorm vault set`](/guide/environments/vault) | Yes |

Use `noorm secret` for a value that differs for you. Use `noorm vault set` for a value the whole team and CI need. A team value set with `noorm secret set` lives in your `state.enc` only, so a teammate or a CI runner finds nothing, or finds a stale vault value. [`noorm settings secret`](/cli/settings-secret) declares which secrets a stage requires; it never stores a value.


## secret set


```
noorm secret set <key> [value] [--stdin] [--config <name>] [--json] [--yes]
```

| Flag | Effect |
|------|--------|
| `<key>` | Secret name. Required |
| `[value]` | The value. Omit it with `--stdin` |
| `--stdin` | Read the value from stdin, keeping it out of the process table, shell history, and `set -x` traces. One trailing newline is stripped |
| `--config <name>`, `-c <name>` | Target a config other than the active one |
| `--json` | `{"success":true,"configName":"prod","key":"PAYMENT_GATEWAY_KEY"}` |
| `--yes`, `-y` | Confirm the write when your role on the config asks first |

| Condition | Behavior |
|-----------|----------|
| Value and `--stdin` together | `Pass the value as an argument or via --stdin, not both.`, exit 1 |
| Neither | `Missing secret value. Pass it as an argument, or pipe it in with --stdin.`, exit 1 |
| `--stdin` with empty input | `No secret value on stdin.`, exit 1 |
| No `--config` and no active config | `No config specified and no active config set. Use --config or run "noorm config use <name>".`, exit 1 |
| Config does not exist | `Config "nope" not found.`, exit 1 |
| Your role is `operator` | `Writing a secret to config "staging" requires confirmation (yes-staging). Pass --yes to confirm.`, exit 1 |
| Your role does not allow `secret:write` | The policy message, exit 1 |

`--yes` and `NOORM_YES=1` both confirm.


## secret list


```
noorm secret list [--config <name>] [--json]
```

```bash
noorm secret list --json
```

```json
{"success":true,"configName":"prod","keys":["API_KEY","DB_PASSWORD"]}
```

An empty config prints `No secrets set for config "prod".`. Unknown config, no active config, or a role without `secret:read` exit 1, with the messages above.


## secret rm


```
noorm secret rm <key> --yes [--config <name>] [--json]
```

```bash
noorm secret rm OLD_KEY --yes --config prod
```

| Condition | Behavior |
|-----------|----------|
| No `--yes` and no `NOORM_YES` | `Pass --yes to confirm deletion of secret "OLD_KEY" from config "prod".`, exit 1 |
| Key not on the config | `Secret "OLD_KEY" not found in config "prod".`, exit 2 |
| Removed | `Secret "OLD_KEY" removed from config "prod".`, exit 0 |


## Exit codes


| Code | Meaning | Remedy |
|------|---------|--------|
| 0 | Done | None |
| 1 | Bad value input, unknown or missing config, state would not load, role denied, or confirmation missing | Read the message. Add `--config`, `--yes`, or `--stdin` as it says |
| 2 | `rm` named a key the config does not hold | `noorm secret list` shows the keys |


## Next


- [Secrets](/guide/environments/secrets): config-scoped versus global secrets
- [Vault](/guide/environments/vault): team secrets and CI provisioning
- [`noorm settings secret`](/cli/settings-secret): declare required secrets per stage

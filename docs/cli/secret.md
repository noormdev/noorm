# noorm secret


Manage **config-scoped local secrets** — values stored on disk in `.noorm/state/state.enc`,
tied to a single config, and never shared with the rest of the team. This is one of three
places a secret value can live; see [Which tier?](#which-tier) below before reaching for it.


## Subcommands

| Command | Purpose |
|---------|---------|
| `noorm secret set <key> <value>` | Store a secret for the active or named config |
| `noorm secret list` | List secret keys for a config (values never shown) |
| `noorm secret rm <key>` | Remove a secret from a config |


## Flags

Common to every subcommand:

- `--config <name>` / `-c <name>` — target a config other than the active one
- `--json` — emit machine-readable JSON on stdout

`secret rm` additionally requires:

- `--yes` / `-y` — confirm the deletion; omitted, the command exits non-zero without deleting


## Which tier?

noorm resolves `$.secrets.KEY` in a template from three tiers, config-local first:

| Tier | Command | Scope | Shared with team? |
|------|---------|-------|--------------------|
| Config-local | `noorm secret set` | One config | No — per-user, per-machine |
| Global-local | TUI only (`noorm ui` → Settings → Secrets) | Every config on this machine | No — per-user, per-machine |
| Vault | [`noorm vault set`](../guide/environments/vault.md) | Every config, every teammate | Yes — encrypted in the database |

If a value should be different for you than for the rest of the team, it belongs in
`noorm secret` (or the TUI's global-local screen). If it should be the same for everyone —
CI included — it belongs in `noorm vault set`. `noorm secret set` on a value the whole team
needs is the mistake this page exists to prevent: it lands in your local `state.enc` only,
so a teammate or a CI runner resolving the same key finds nothing and either fails loudly (a
missing secret now throws — see [Templates](../guide/sql-files/templates.md)) or silently
picks up a stale vault value instead of the one you just set.

See [Secrets](../guide/environments/secrets.md) for config-scoped vs. global-local, and
[Vault](../guide/environments/vault.md) for the full three-tier resolution hierarchy and
team-provisioning workflow.


## Examples

    noorm secret set API_KEY "sk-live-..."
    noorm secret set DB_PASSWORD "secret123" --config prod
    noorm secret set API_KEY "sk-live-..." --json

    noorm secret list
    noorm secret list --config staging --json

    noorm secret rm OLD_KEY --yes
    noorm secret rm OLD_KEY --yes --config prod


## Related

- [`noorm settings secret`](./settings-secret.md) — edits which secrets a stage *requires*,
  not their values.
- [Secrets guide](../guide/environments/secrets.md) — full CLI + TUI workflow.
- [Vault guide](../guide/environments/vault.md) — team-shared secrets and CI provisioning.

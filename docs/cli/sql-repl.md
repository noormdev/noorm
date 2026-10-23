# noorm sql repl


Open the TUI directly on the SQL terminal, against the active config or the one you name.

```bash
noorm sql repl --config dev
```

The terminal opens with the query box focused. `Enter` runs the query and `Esc` backs out. [The TUI page](/tui#sql-terminal) lists the keys, and [the SQL terminal guide](/guide/database/terminal) covers history, result browsing, and cancel.


## Flags


| Flag | Effect |
|------|--------|
| `--config <name>`, `-c <name>` | Make this config the active one, then launch. The switch is saved, so it outlasts the session |
| `--yes`, `-y` | Accepted only to refuse: see below |


## Where does it refuse to run?


A REPL is interactive, so `--yes` and `NOORM_YES` cannot make it run unattended.

| Condition | Behavior |
|-----------|----------|
| `--yes`, `-y`, or `NOORM_YES=1` | `Error: noorm sql repl is interactive only.` with `noorm sql query "SELECT 1"` and `noorm sql query --file query.sql` as the headless routes. Exit 2 |
| No terminal on stdin | `Error: noorm sql repl requires an interactive terminal.`, exit 2 |
| `--config` names a config that does not exist | `Error: Config not found: <name>`, exit 2 |
| State cannot be decrypted | `Error: <message>`, exit 1 |

Use [`noorm sql query`](/cli/sql) for one-shot SQL in scripts and CI. History from the terminal is what [`noorm sql history`](/cli/sql#sql-history) reads.


## Next


- [`noorm sql`](/cli/sql): one-shot queries and history
- [The TUI](/tui): keys for every screen

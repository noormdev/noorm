# Terminal UI


Launch the interactive terminal interface with:

```bash
noorm ui
```

![A full pass through the TUI: adding a config, creating the database, building the schema, fast-forwarding changes, and browsing the result in the explorer](/image/tui.gif)

Everything in noorm is accessible through keyboard shortcuts. No mouse needed.

The TUI is a dedicated subcommand — every other `noorm` command runs as a non-interactive CLI. Running `noorm` on its own prints the command list (citty's `--help`) instead of opening the wizard, so the entry into the TUI is always explicit. See the [CLI Reference](/headless) for the headless surface.


## Home Screen

![The noorm TUI home screen: status, quick actions, and recent activity](/image/tui/home.png)


## Navigation Map

```
                              ┌─────────┐
                              │  Home   │
                              └────┬────┘
        ┌──────────┬──────────┬────┴────┬──────────┬──────────┐
        │          │          │         │          │          │
     [c]│       [g]│       [r]│      [d]│       [s]│       [k]│
        ▼          ▼          ▼         ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Config │ │ Change │ │  Run   │ │Database│ │Settings│ │Secrets │
   │  List  │ │  List  │ │  Menu  │ │  Menu  │ │  Menu  │ │  List  │
   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
        │          │          │         │
        │          │          │         ├── Explore (tables, views...)
        │          │          │         └── Terminal (SQL REPL)
        │          │          │
        │          │          └── Build, File, Directory
        │          │
        │          └── FF, Run, Revert, History
        │
        └── Add, Edit, Delete, Use, Validate, Export, Import
```


## Keyboard Shortcuts


### Home Navigation

| Key | Screen | Description |
|-----|--------|-------------|
| `r` | Run | Execute schema files |
| `c` | Config | Manage database connections |
| `g` | Changes | View and apply changes |
| `d` | Database | Explore schema, run queries |
| `+` | More | Settings, vault, identity, lock |
| `s` | Settings | Project configuration |
| `v` | Vault | Team-shared encrypted secrets |
| `i` | Identity | View/edit your identity |
| `l` | Lock | View/manage database locks |
| `u` | Update | Check for a newer noorm |
| `q` | — | Quit noorm |

`s`, `v`, `i`, and `l` work from Home directly as well as from `[+] More`.
Three number keys run the quick actions listed on the home screen:

| Key | Action |
|-----|--------|
| `1` | Run build |
| `2` | Apply changes (fast-forward) |
| `3` | View lock status |

Per-config **secrets** are not on this list — they hang off a config rather
than the project, so you reach them with `k` from the config list.


### Common Actions (in sub-screens)

| Key | Action | Available In |
|-----|--------|--------------|
| `a` | Add new | Config, Changes, Secrets |
| `e` | Edit | Config, Changes, Secrets |
| `d` | Delete | Config, Changes, Secrets |
| `c` | Copy | Config |
| `k` | Secrets | Config (secrets for the highlighted config) |
| `+` | More | Config (export, import, validate) |
| `Enter` | Use/Activate | Config (set as active) |

Export, import, and validate live behind `[+] More` on the config list rather
than on the list itself, which keeps the destructive and the routine actions
apart.


### List Navigation

| Key | Action |
|-----|--------|
| `↑` | Move up |
| `↓` | Move down |
| `Enter` | Select |
| `Escape` | Go back |
| `1`-`9` | Quick select by number, on lists that show numbers |

Numbered selection is enabled per list — if a list renders numbers down its
left edge (Settings and the schema explorer do), the digits work there.


### Global Shortcuts

| Key | Action |
|-----|--------|
| `Shift+L` | Toggle log viewer overlay |
| `Shift+Q` | Open the SQL terminal |
| `?` | Show help |
| `Escape` | Go back / Cancel |
| `Ctrl+C` | Quit |


## Screen Reference


### Config List

![The configuration list screen](/image/tui/config-list.png)

- `●` indicates active config
- `○` indicates inactive config
- `>` indicates cursor position
- `[user:<role> agent:<role|off>]` tag shows access roles for any config whose access differs from the default (`user: admin`, `agent: viewer`) — omitted entirely for configs still on the default
- `[test]` tag shows test configs
- Press `Enter` on a config to activate it

Press `a` to add one. Adding a config is the one operation that is interactive only — `noorm config add` on the CLI directs you here:

![The add-config form: name, dialect, connection details, and per-channel access roles](/image/tui/config-add.png)

The two role fields set access per **channel** — who is *driving*. `User Role` covers a human on the CLI, TUI, or SDK; `Agent Role` covers an AI agent, over MCP and the CLI alike. They are independent, so a config can be wide open at your terminal and read-only — or invisible — to an agent. New configs default to `admin` for you and `viewer` for the agent. See [Configs](/guide/environments/configs#access-roles) for what each role permits.


### Changes List

![The changes list, showing applied and pending changes](/image/tui/changes-list.png)

- `✓` = Applied
- `○` = Pending
- `✗` = Failed

When no changes exist:

```
No changes found. Press [a] to create one.
```

Press `h` for the execution history — what ran, when, and who ran it:

![Change execution history, with per-change status and the identity that applied it](/image/tui/change-history.png)


### Run Menu

![The run menu](/image/tui/run-menu.png)


### Database Menu

![The database operations menu](/image/tui/database-menu.png)


### Schema Explorer

![The schema explorer overview, with object counts by category](/image/tui/explore-overview.png)

Press a number to drill into a category:

![The explorer table list](/image/tui/explore-tables.png)

Select a table to see its full schema:

![Table detail: columns, indexes, and foreign keys](/image/tui/explore-table-detail.png)


### SQL Terminal

Press `Shift+Q` anywhere to open the SQL terminal against the active config:

![The built-in SQL terminal](/image/tui/sql-terminal.png)

- Tab completion for table/column names
- Query history with up/down arrows
- Results cached for review


### Log Viewer

Press `Shift+L` anywhere to toggle the log overlay:

![The log viewer overlay, opened with Shift+L](/image/tui/log-viewer.png)

The overlay sits on top of whatever screen you were on, so you can watch events
while an operation runs. `[/]` searches, `[Space]` pauses the live tail, and
`[Enter]` opens a single entry in full.


### More Options

Press `+` from home for the screens that aren't part of the day-to-day loop:

![The More Options menu: settings, vault, identity, and lock](/image/tui/more-menu.png)

Each of these also has a direct key from home — `+` just groups them.


### Settings

![The settings screen, listing the seven setting groups](/image/tui/settings.png)

Edits here write to `.noorm/settings.yml`. Press `i` to create that file if the
project doesn't have one yet. See [Configs](/guide/environments/configs) and
[SQL File Organization](/guide/sql-files/organization) for what each group
controls.


### Identity

![The identity screen, showing the current keypair and fingerprint](/image/tui/identity.png)

Your identity signs your name to every change execution, which is what makes
[change history](/guide/changes/history) attributable across a team. It lives
in `~/.noorm/`, not in the project, so it follows you between repositories.


### Vault

![The vault screen before initialization](/image/tui/vault.png)

The vault holds team-shared encrypted secrets in the database itself, so
teammates get them by connecting rather than by copying a `.env` around. It
starts uninitialized — press `i` to create it. See [Vault](/guide/environments/vault).


### Secrets

Per-config secrets are reached with `k` from the config list, not from home —
they belong to a config rather than to the project:

![The secrets screen for a config](/image/tui/secrets.png)

These are values a config needs at connection or render time. See
[Secrets](/guide/environments/secrets) for how they resolve against stages.


### Lock

![The lock screen, showing current lock state](/image/tui/lock.png)

noorm takes a lock around operations that write to the database, so two people
running a build against the same environment don't interleave. `[s]` shows
status, `[a]` acquires, `[r]` releases, and `[f]` force-breaks a stale lock.
See [Locking](/dev/lock).


## Tips


### Quick Config Switching

From home, press `c` then the number of the config you want, then `Enter` to activate:

```
c → 2 → Enter
```


### Fast Forward All Changes

```
g → f
```


### Run Build

```
r → b
```


### Check Connection

```
c → v (validate current config)
```


## Color Coding

| Color | Meaning |
|-------|---------|
| Green | Success, applied, active |
| Yellow | Warning, pending, in progress |
| Red | Error, failed |
| Gray | Skipped, unchanged |
| Cyan | Info, links |

# Terminal UI


Launch the terminal interface with:

```bash
noorm
```

Everything in noorm is accessible through keyboard shortcuts. No mouse needed.


## Home Screen

```
┌─────────────────────────────────────────────────────────────┐
│  noorm                                              v1.0.0  │
│  Config: dev (sqlite)                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    [c] config      Manage database configurations           │
│    [g] changes     View and run migrations                  │
│    [r] run         Execute schema files                     │
│    [d] database    Explore schema, run queries              │
│    [l] lock        View lock status                         │
│    [s] settings    Project settings                         │
│    [k] secrets     Manage secrets                           │
│    [i] identity    View/edit your identity                  │
│                                                             │
│    [q] quit                                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


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
| `c` | Config | Manage database connections |
| `g` | Changes | View and run migrations |
| `r` | Run | Execute schema files |
| `d` | Database | Explore schema, run queries |
| `l` | Lock | View/manage database locks |
| `s` | Settings | Project configuration |
| `k` | Secrets | Manage encrypted secrets |
| `i` | Identity | View/edit your identity |
| `q` | — | Quit noorm |


### Common Actions (in sub-screens)

| Key | Action | Available In |
|-----|--------|--------------|
| `a` | Add new | Config, Changes, Secrets, Settings |
| `e` | Edit | Config, Secrets, Settings |
| `d` | Delete | Config, Changes, Secrets |
| `u` | Use/Activate | Config (set as active) |
| `v` | Validate | Config (test connection) |
| `x` | Export | Config, Identity |
| `i` | Import | Config |


### List Navigation

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Enter` | Select |
| `Escape` | Go back |
| `1`-`9` | Quick select item by number |


### Global Shortcuts

| Key | Action |
|-----|--------|
| `Shift+L` | Toggle log viewer overlay |
| `Escape` | Go back / Cancel |
| `Ctrl+C` | Quit |


## Screen Reference


### Config List

```
┌─ Configurations ────────────────────────────────────────────┐
│                                                             │
│  1. • dev        sqlite    ./data/dev.db                    │
│  2.   staging    postgres  db.staging.example.com           │
│  3.   prod       postgres  db.prod.example.com      🔒      │
│                                                             │
│  [a] add   [e] edit   [d] delete   [u] use   [v] validate   │
│  [x] export   [i] import                                    │
└─────────────────────────────────────────────────────────────┘
```

- `•` indicates active config
- 🔒 indicates protected config
- Press `1`, `2`, `3` to quick-select


### Changes List

```
┌─ Changes ───────────────────────────────────────────────────┐
│                                                             │
│  1. ✓ 2024-01-15-init-schema         Applied 2024-01-15     │
│  2. ✓ 2024-01-20-add-user-roles      Applied 2024-01-20     │
│  3. ○ 2024-02-01-add-notifications   Pending                │
│                                                             │
│  [f] fast-forward   [r] run   [v] revert   [h] history      │
└─────────────────────────────────────────────────────────────┘
```

- `✓` = Applied
- `○` = Pending
- `✗` = Failed


### Run Menu

```
┌─ Run ───────────────────────────────────────────────────────┐
│                                                             │
│  1. Build          Execute all schema files                 │
│  2. File           Run a single SQL file                    │
│  3. Directory      Run all files in a directory             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


### Database Menu

```
┌─ Database ──────────────────────────────────────────────────┐
│                                                             │
│  [e] explore       Browse tables, views, indexes            │
│  [t] terminal      Interactive SQL REPL                     │
│  [w] truncate      Wipe all data (keep schema)              │
│  [x] teardown      Drop all objects                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


### Schema Explorer

```
┌─ Schema Overview ───────────────────────────────────────────┐
│                                                             │
│  Tables:      12                                            │
│  Views:        3                                            │
│  Indexes:      8                                            │
│  Foreign Keys: 5                                            │
│  Functions:    2                                            │
│  Procedures:   0                                            │
│                                                             │
│  [t] tables   [v] views   [i] indexes   [f] foreign keys    │
└─────────────────────────────────────────────────────────────┘
```

Drill down into any category to see details:

```
┌─ Tables ────────────────────────────────────────────────────┐
│                                                             │
│  1. users              1,234 rows                           │
│  2. posts             15,678 rows                           │
│  3. comments          45,123 rows                           │
│  4. notifications      8,901 rows                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Select a table to see its schema:

```
┌─ users ─────────────────────────────────────────────────────┐
│                                                             │
│  Columns:                                                   │
│    id          INTEGER      PRIMARY KEY                     │
│    name        TEXT         NOT NULL                        │
│    email       TEXT         UNIQUE                          │
│    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP       │
│                                                             │
│  Indexes:                                                   │
│    users_email_idx    UNIQUE (email)                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


### SQL Terminal

```
┌─ SQL Terminal ──────────────────────────────────────────────┐
│                                                             │
│  noorm> SELECT * FROM users LIMIT 3;                        │
│                                                             │
│  ┌────┬─────────┬─────────────────┬─────────────────────┐   │
│  │ id │ name    │ email           │ created_at          │   │
│  ├────┼─────────┼─────────────────┼─────────────────────┤   │
│  │  1 │ Alice   │ alice@email.com │ 2024-01-15 09:30:00 │   │
│  │  2 │ Bob     │ bob@email.com   │ 2024-01-16 14:22:00 │   │
│  │  3 │ Charlie │ charlie@co.com  │ 2024-01-17 11:45:00 │   │
│  └────┴─────────┴─────────────────┴─────────────────────┘   │
│                                                             │
│  3 rows (12ms)                                              │
│                                                             │
│  noorm> _                                                   │
│                                                             │
│  [h] history   [c] clear                                    │
└─────────────────────────────────────────────────────────────┘
```

- Tab completion for table/column names
- Query history with up/down arrows
- Results cached for review


### Log Viewer

Press `Shift+L` anywhere to toggle the log overlay:

```
┌─ Logs ──────────────────────────────────────────────────────┐
│                                                             │
│  09:30:01 INFO  Connected to dev (sqlite)                   │
│  09:30:02 INFO  Building schema...                          │
│  09:30:02 DEBUG Checking sql/tables/users.sql            │
│  09:30:02 INFO  ✓ sql/tables/users.sql (changed)         │
│  09:30:03 DEBUG Checking sql/tables/posts.sql            │
│  09:30:03 INFO  • sql/tables/posts.sql (unchanged)       │
│                                                             │
│  [/] search   [p] pause   [Shift+L] close                   │
└─────────────────────────────────────────────────────────────┘
```


## Tips


### Quick Config Switching

From home, press `c` then the number of the config you want, then `u` to activate:

```
c → 2 → u
```


### Fast Forward All Changes

```
g → f
```


### Run Build

```
r → 1
```

Or just:
```
r → Enter (Build is pre-selected)
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

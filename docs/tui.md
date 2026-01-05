# Terminal UI


Launch the terminal interface with:

```bash
noorm
```

Everything in noorm is accessible through keyboard shortcuts. No mouse needed.


## Home Screen

```
noorm - Database Schema & Change Manager

Active Config:  dev  |  Configs: 2

┌─ Status ─────────────────────┐  ┌─ Quick Actions ──────────────┐
│                              │  │                              │
│ Connection: ● Connected      │  │ [1] Run Build                │
│ Pending:    0 pending        │  │ [2] Apply Changes (ff)       │
│ Lock:       FREE             │  │ [3] View Lock Status         │
│                              │  │                              │
│ Stage Configs:               │  │                              │
│   ✓ dev                      │  │                              │
│     prod [protected]         │  │                              │
│                              │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘

┌─ Recent Activity ────────────────────────────────────────────┐
│                                                              │
│ [OK] [BUILD] build:2024-01-15T10:30:00Z in 2 hours (0.3s)   │
│                                                              │
└──────────────────────────────────────────────────────────────┘

[c]onfig chan[g]e [r]un [d]b [l]ock [s]ettings [k]eys [i]dentity [q]uit
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
| `g` | Changes | View and apply changes |
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
| `c` | Copy | Config |
| `v` | Validate | Config (test connection) |
| `x` | Export | Config, Identity |
| `i` | Import | Config |
| `Enter` | Use/Activate | Config (set as active) |


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
Home > Configurations

┌─ Configurations ────────────────────────────────────────────┐
│                                                             │
│ > ○ dev       postgres                                      │
│   ● test      postgres (active) [test]                      │
│   ○ prod      postgres [protected]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘

[a] Add  [e] Edit  [d] Delete  [c] Copy  [x] Export  [i] Import  [v] Validate  [Enter] Use

[Esc] Back
```

- `●` indicates active config
- `○` indicates inactive config
- `>` indicates cursor position
- `[protected]` tag shows protected configs
- `[test]` tag shows test configs
- Press `Enter` on a config to activate it


### Changes List

```
Home > Changes

┌─ Changes ───────────────────────────────────────────────────┐
│                                                             │
│ Total: 3   Applied: 2   Pending: 1                          │
│                                                             │
│ > ✓ 2024-01-15-init-schema                                  │
│   ✓ 2024-01-20-add-user-roles                               │
│   ○ 2024-02-01-add-notifications                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘

[a]dd  [e]dit  [d]elete  [r]un  re[v]ert  [n]ext  [f]f  re[w]ind  [h]istory

[Esc] Back
```

- `✓` = Applied
- `○` = Pending
- `✗` = Failed

When no changes exist:

```
No changes found. Press [a] to create one.
```


### Run Menu

```
Home > Run SQL

┌─ Run SQL Files ─────────────────────────────────────────────┐
│                                                             │
│ Config:       dev (local)                                   │
│ Schema Path:  sql                                           │
│                                                             │
│ Effective Build Paths:                                      │
│   Include: tables, views                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─ Available Actions ─────────────────────────────────────────┐
│                                                             │
│ [b] Build - Execute full schema build                       │
│ [e] Exec  - Pick files to execute                           │
│ [f] File  - Execute a single file                           │
│ [d] Dir   - Execute all files in a directory                │
│                                                             │
└─────────────────────────────────────────────────────────────┘

[b] Build  [e] Exec  [f] File  [d] Dir  [Esc] Back
```


### Database Menu

```
Home > Databases

┌─ Database Operations ───────────────────────────────────────┐
│                                                             │
│ Config:             dev                                     │
│ Connection:         CONNECTED                               │
│ Tracking Tables:    Initialized                             │
│ Tracked Executions: 12                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─ Available Actions ─────────────────────────────────────────┐
│                                                             │
│ [c] Create   - Build database from SQL files                │
│ [d] Destroy  - Drop all managed objects                     │
│ [x] Explore  - Browse database schema                       │
│ [w] Wipe     - Truncate table data (keep schema)            │
│ [t] Teardown - Drop user objects (keep noorm)               │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Warning: These operations modify the database directly.

[c] Create  [d] Destroy  [x] Explore  [w] Wipe  [t] Teardown  [Esc] Back
```


### Schema Explorer

```
Home > Databases > Explore Database

┌─ DB Explore ────────────────────────────────────────────────┐
│                                                             │
│ Config:        dev (postgres)                               │
│ Database:      myapp_dev                                    │
│ Total Objects: 47                                           │
│                                                             │
│ [1] Tables        3                                         │
│ [2] Views         3                                         │
│ [3] Procedures    0                                         │
│ [4] Functions     5                                         │
│ [5] Types         0                                         │
│ [6] Indexes      13                                         │
│ [7] Foreign Keys  2                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘

[1-7] Navigate  [Esc] Back
```

Press a number to drill into a category:

```
Databases > Explore Database > Tables

┌─ Tables (3) ────────────────────────────────────────────────┐
│                                                             │
│ / Filter tables...                                          │
│                                                             │
│ 1 > public.todo_items  13 columns                           │
│ 2   public.todo_lists   9 columns                           │
│ 3   public.users        9 columns                           │
│                                                             │
│ [/] Search                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

[Enter] View detail  [Esc] Back
```

Select a table to see its full schema:

```
public.todo_items

Columns (13)
* id              uuid                      NOT NULL DEFAULT gen_random_uuid()
  embedding       USER-DEFINED              NULL
  created_at      timestamp with time zone  NOT NULL DEFAULT now()
  updated_at      timestamp with time zone  NOT NULL DEFAULT now()
  deleted_at      timestamp with time zone  NULL
  list_id         uuid                      NOT NULL
  title           character varying         NOT NULL
  description     text                      NULL
  is_completed    boolean                   NOT NULL DEFAULT false
  priority        smallint                  NOT NULL DEFAULT 0
  due_date        timestamp with time zone  NULL
  completed_at    timestamp with time zone  NULL
  position        integer                   NOT NULL DEFAULT 0

Indexes (5)
  idx_todo_items_due_date      (due_date)
  idx_todo_items_embedding     (embedding vector_cosine_ops)
  idx_todo_items_list_id       (list_id)
  idx_todo_items_position      (list_id, "position")
  todo_items_pkey              (id) UNIQUE

Foreign Keys (1)
  todo_items_list_id_fkey
    (list_id) → todo_lists(id)

[Esc] Back
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
│  09:30:02 DEBUG Checking sql/01_tables/001_users.sql     │
│  09:30:02 INFO  ✓ sql/01_tables/001_users.sql (changed)  │
│  09:30:03 DEBUG Checking sql/01_tables/002_posts.sql     │
│  09:30:03 INFO  • sql/01_tables/002_posts.sql (unchanged)│
│                                                             │
│  [/] search   [p] pause   [Shift+L] close                   │
└─────────────────────────────────────────────────────────────┘
```


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

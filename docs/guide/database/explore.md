# Schema Explorer


The Schema Explorer gives you read-only access to your database structure directly from the terminal. No need to switch to pgAdmin, MySQL Workbench, or Azure Data Studio. Browse tables, views, indexes, foreign keys, functions, procedures, and types without leaving your workflow.


## What It Shows

The explorer queries your database's system catalogs to reveal its structure:

| Category | Information |
|----------|-------------|
| Tables | Columns, data types, row estimates, indexes, foreign keys |
| Views | Columns, definition SQL, whether it is updatable |
| Indexes | Table, columns, unique/primary status |
| Foreign Keys | Source and target tables, column mappings, cascade rules |
| Functions | Parameters, return type, definition |
| Procedures | Parameters, definition |
| Types | Enum values, composite attributes, domain base types |


## Accessing the Explorer


### Terminal UI

From the home screen, press `d` to enter the Database menu, then `e` to explore:

```
Home → [d] Database → [e] Explore
```

Or navigate directly through the menu:

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


### Headless Mode

For scripts and CI/CD pipelines, use headless mode with the `-H` flag:

```bash
noorm -H db explore                          # Overview
noorm -H db explore tables                   # List tables
noorm -H db explore tables detail users      # Table detail
noorm -H --json db explore > schema.json     # JSON output
```


## Overview Screen

The overview shows counts of all database objects at a glance:

```
┌─ DB Explore ────────────────────────────────────────────────┐
│                                                             │
│  Config:        dev (postgres)                              │
│  Database:      myapp_development                           │
│  Total Objects: 47                                          │
│                                                             │
│  [1] Tables         12                                      │
│  [2] Views           3                                      │
│  [3] Procedures      0                                      │
│  [4] Functions       5                                      │
│  [5] Types           2                                      │
│  [6] Indexes        18                                      │
│  [7] Foreign Keys    7                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [1-7] Navigate   [Esc] Back
```

Press the number key or hotkey to drill into any category. Categories with zero items appear dimmed and cannot be selected.

| Key | Hotkey | Category |
|-----|--------|----------|
| `1` | `t` | Tables |
| `2` | `v` | Views |
| `3` | `p` | Procedures |
| `4` | `f` | Functions |
| `5` | `y` | Types |
| `6` | `i` | Indexes |
| `7` | `k` | Foreign Keys |


## Browsing Tables

Press `1` or `t` from the overview to see all tables:

```
┌─ Tables (12) ───────────────────────────────────────────────┐
│                                                             │
│  /  Filter tables...                                        │
│                                                             │
│  1. > public.users          8 columns, ~1.5K rows           │
│  2.   public.posts          5 columns, ~42K rows            │
│  3.   public.comments       4 columns, ~128K rows           │
│  4.   public.notifications  6 columns, ~8.9K rows           │
│  5.   public.sessions       3 columns, ~2.1K rows           │
│                                                             │
│  ... 7 more                                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Enter] View detail   [Esc] Back
```

The list is searchable. Press `/` to focus the filter field and type to narrow results. Press `1-9` for quick selection.


### Table Detail

Select a table to see its full schema:

```
┌─ Table ─────────────────────────────────────────────────────┐
│                                                             │
│  public.users                           ~1,500 rows         │
│                                                             │
│  Columns (8)                                                │
│  ─────────────────────────────────────────────────────────  │
│  * id            uuid             NOT NULL                  │
│    email         varchar(255)     NOT NULL                  │
│    name          varchar(100)     NULL                      │
│    password_hash text             NOT NULL                  │
│    role          user_role        NOT NULL DEFAULT 'user'   │
│    active        boolean          NOT NULL DEFAULT true     │
│    created_at    timestamptz      NOT NULL DEFAULT now()    │
│    updated_at    timestamptz      NULL                      │
│                                                             │
│  Indexes (2)                                                │
│  ─────────────────────────────────────────────────────────  │
│  * users_pkey              (id)                             │
│    users_email_idx         (email) UNIQUE                   │
│                                                             │
│  Foreign Keys (0)                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```

The `*` marker indicates primary key columns and primary key indexes.


## Browsing Views

Press `2` or `v` from the overview:

```
┌─ Views (3) ─────────────────────────────────────────────────┐
│                                                             │
│  1. > public.active_users     4 columns, READ-ONLY          │
│  2.   public.post_stats       6 columns, READ-ONLY          │
│  3.   public.user_activity    8 columns, UPDATABLE          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Enter] View detail   [Esc] Back
```


### View Detail

```
┌─ View ──────────────────────────────────────────────────────┐
│                                                             │
│  public.active_users                    READ-ONLY           │
│                                                             │
│  Columns (4)                                                │
│  ─────────────────────────────────────────────────────────  │
│    id            uuid             NOT NULL                  │
│    email         varchar(255)     NOT NULL                  │
│    name          varchar(100)     NULL                      │
│    created_at    timestamptz      NOT NULL                  │
│                                                             │
│  Definition                                                 │
│  ─────────────────────────────────────────────────────────  │
│  SELECT id, email, name, created_at                         │
│  FROM users                                                 │
│  WHERE active = true                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```


## Browsing Indexes and Foreign Keys

Indexes and foreign keys are list-only categories. They show all the information inline without a separate detail screen.


### Indexes

```
┌─ Indexes (18) ──────────────────────────────────────────────┐
│                                                             │
│  1.   users_pkey              on users, PRIMARY             │
│  2.   users_email_idx         on users, UNIQUE              │
│  3.   posts_pkey              on posts, PRIMARY             │
│  4.   posts_user_id_idx       on posts                      │
│  5.   posts_created_at_idx    on posts                      │
│  6.   comments_pkey           on comments, PRIMARY          │
│                                                             │
│  ... 12 more                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```


### Foreign Keys

```
┌─ Foreign Keys (7) ──────────────────────────────────────────┐
│                                                             │
│  1.   posts_user_id_fkey                                    │
│       posts(user_id) → users(id) ON DELETE CASCADE          │
│                                                             │
│  2.   comments_post_id_fkey                                 │
│       comments(post_id) → posts(id) ON DELETE CASCADE       │
│                                                             │
│  3.   comments_user_id_fkey                                 │
│       comments(user_id) → users(id) ON DELETE SET NULL      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```


## Browsing Functions and Procedures

Functions and procedures show parameters, return types, and definitions.


### Functions

```
┌─ Functions (5) ─────────────────────────────────────────────┐
│                                                             │
│  1. > public.calculate_total    2 params → numeric          │
│  2.   public.get_user_posts     1 param → SETOF posts       │
│  3.   public.update_timestamp   0 params → trigger          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Enter] View detail   [Esc] Back
```


### Function Detail

```
┌─ Function ──────────────────────────────────────────────────┐
│                                                             │
│  public.calculate_total                 → numeric           │
│                                                             │
│  Parameters (2)                                             │
│  ─────────────────────────────────────────────────────────  │
│    price           numeric         IN                       │
│    quantity        integer         IN                       │
│                                                             │
│  Definition                                                 │
│  ─────────────────────────────────────────────────────────  │
│  BEGIN                                                      │
│      RETURN price * quantity;                               │
│  END;                                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```


### Procedures

Procedures work the same way as functions, but without a return type.


## Browsing Types

Custom types are available in PostgreSQL and MSSQL. The explorer shows enum values, composite type attributes, and domain/alias base types.

```
┌─ Types (2) ─────────────────────────────────────────────────┐
│                                                             │
│  1. > public.user_role       ENUM, 3 values                 │
│  2.   public.address         COMPOSITE, 5 attributes        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Enter] View detail   [Esc] Back
```


### Enum Type Detail

```
┌─ Type ──────────────────────────────────────────────────────┐
│                                                             │
│  public.user_role                       ENUM                │
│                                                             │
│  Values (3)                                                 │
│  ─────────────────────────────────────────────────────────  │
│    user                                                     │
│    moderator                                                │
│    admin                                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```


### Composite Type Detail

```
┌─ Type ──────────────────────────────────────────────────────┐
│                                                             │
│  public.address                         COMPOSITE           │
│                                                             │
│  Attributes (5)                                             │
│  ─────────────────────────────────────────────────────────  │
│    street          varchar(200)    NOT NULL                 │
│    city            varchar(100)    NOT NULL                 │
│    state           varchar(50)     NULL                     │
│    postal_code     varchar(20)     NOT NULL                 │
│    country         varchar(100)    NOT NULL                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  [Esc] Back
```


## Headless JSON Output

Use `--json` flag for machine-readable output.


### Overview

```bash
noorm -H --json db explore
```

```json
{
    "tables": 12,
    "views": 3,
    "procedures": 0,
    "functions": 5,
    "types": 2,
    "indexes": 18,
    "foreignKeys": 7
}
```


### Table List

```bash
noorm -H --json db explore tables
```

```json
[
    { "name": "users", "schema": "public", "columnCount": 8, "rowCountEstimate": 1500 },
    { "name": "posts", "schema": "public", "columnCount": 5, "rowCountEstimate": 42000 },
    { "name": "comments", "schema": "public", "columnCount": 4, "rowCountEstimate": 128000 }
]
```


### Table Detail

```bash
noorm -H --json db explore tables detail users
```

```json
{
    "name": "users",
    "schema": "public",
    "columns": [
        { "name": "id", "dataType": "uuid", "isNullable": false, "isPrimaryKey": true, "ordinalPosition": 1 },
        { "name": "email", "dataType": "varchar(255)", "isNullable": false, "isPrimaryKey": false, "ordinalPosition": 2 },
        { "name": "name", "dataType": "varchar(100)", "isNullable": true, "isPrimaryKey": false, "ordinalPosition": 3 },
        { "name": "created_at", "dataType": "timestamptz", "isNullable": false, "defaultValue": "now()", "isPrimaryKey": false, "ordinalPosition": 7 }
    ],
    "indexes": [
        { "name": "users_pkey", "columns": ["id"], "isUnique": true, "isPrimary": true },
        { "name": "users_email_idx", "columns": ["email"], "isUnique": true, "isPrimary": false }
    ],
    "foreignKeys": [],
    "rowCountEstimate": 1500
}
```


### View Detail

```bash
noorm -H --json db explore views detail active_users
```

```json
{
    "name": "active_users",
    "schema": "public",
    "columns": [
        { "name": "id", "dataType": "uuid", "isNullable": false, "isPrimaryKey": false, "ordinalPosition": 1 },
        { "name": "email", "dataType": "varchar(255)", "isNullable": false, "isPrimaryKey": false, "ordinalPosition": 2 }
    ],
    "definition": "SELECT id, email FROM users WHERE active = true",
    "isUpdatable": false
}
```


### Function Detail

```bash
noorm -H --json db explore functions detail calculate_total
```

```json
{
    "name": "calculate_total",
    "schema": "public",
    "parameters": [
        { "name": "price", "dataType": "numeric", "mode": "IN", "ordinalPosition": 1 },
        { "name": "quantity", "dataType": "integer", "mode": "IN", "ordinalPosition": 2 }
    ],
    "returnType": "numeric",
    "definition": "BEGIN RETURN price * quantity; END;"
}
```


## Dialect Support

The explorer works across all supported databases with appropriate translations:

| Category | PostgreSQL | MySQL | MSSQL | SQLite |
|----------|:----------:|:-----:|:-----:|:------:|
| Tables | Yes | Yes | Yes | Yes |
| Views | Yes | Yes | Yes | Yes |
| Indexes | Yes | Yes | Yes | Yes |
| Foreign Keys | Yes | Yes | Yes | Yes |
| Functions | Yes | Yes | Yes | -- |
| Procedures | Yes | Yes | Yes | -- |
| Types | Yes | -- | Yes | -- |

SQLite does not support stored procedures, functions, or user-defined types. MySQL does not support user-defined types. These categories return empty results for unsupported dialects.

**Type support by dialect:**

- **PostgreSQL** - Enums, composite types, domains
- **MSSQL** - Alias types (e.g., `CREATE TYPE EmailAddress FROM VARCHAR(255)`), table types


## Common Use Cases

**Verify builds.** After running [schema builds](/guide/sql-files/execution), use explore to confirm tables, views, and functions were created correctly.

**Check constraints.** Browse foreign keys to verify referential integrity is set up as expected before deploying.

**Inspect indexes.** Review index coverage before and after adding new queries to ensure performance.

**Compare environments.** Run overview on dev vs prod to spot schema drift quickly. Use different [configs](/guide/environments/configs) with the `-c` flag.

**Debug changes.** When [changes](/guide/changes/overview) fail, explore the current schema state to understand what exists.


## What's Next?

- [SQL Terminal](/guide/database/terminal) - Run queries against your database
- [Teardown](/guide/database/teardown) - Reset database objects
- [Configs](/guide/environments/configs) - Connect to different databases

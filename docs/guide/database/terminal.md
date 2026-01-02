# SQL Terminal


## What It Is

The SQL terminal is an interactive REPL built into noorm. Run queries against your database without leaving the tool or switching to another client.

Debugging a migration? Check if that INSERT worked. Exploring a table structure? Run a quick SELECT. The terminal keeps you in flow while you work.


## Launching the Terminal

From the home screen, press `d` for database, then `t` for terminal:

```
Home → [d] Database → [t] Terminal
```

The terminal connects to your [active configuration](/guide/environments/configs) automatically.


## The Interface

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

Type your SQL at the `noorm>` prompt and press Enter to execute.


## Running Queries

The terminal supports any SQL your database understands:

**SELECT queries** return formatted tables with timing:

```
noorm> SELECT id, email FROM users WHERE active = true LIMIT 5;

┌────┬────────────────────┐
│ id │ email              │
├────┼────────────────────┤
│  1 │ alice@example.com  │
│  2 │ bob@example.com    │
└────┴────────────────────┘

2 rows (8ms)
```

**INSERT, UPDATE, DELETE** report affected rows:

```
noorm> UPDATE users SET last_login = NOW() WHERE id = 1;

1 row affected (5ms)
```

**DDL statements** (CREATE, ALTER, DROP) work too:

```
noorm> CREATE INDEX users_email_idx ON users(email);

OK (42ms)
```


## Result Formatting

Results display in a formatted table with column alignment:

```
┌─────┬────────────────────┬────────┬───────────────────────┐
│ id  │ email              │ name   │ created_at            │
├─────┼────────────────────┼────────┼───────────────────────┤
│ 1   │ alice@example.com  │ Alice  │ 2024-01-15T10:30:00Z  │
│ 2   │ bob@example.com    │ Bob    │ 2024-01-15T11:45:00Z  │
└─────┴────────────────────┴────────┴───────────────────────┘

2 rows (15ms)
```

Long values are truncated with ellipsis to fit the screen. Select a row to view full cell contents in the detail view.

Errors display inline with the original query:

```
noorm> SELECT * FROM nonexistent;

Error: relation "nonexistent" does not exist
```


## Query History

Every query you run is saved. Browse and re-execute past queries without retyping.


### Browsing History

Press `h` to open the history viewer:

```
┌─ Query History ─────────────────────────────────────────────┐
│                                                             │
│  1. SELECT * FROM users LIMIT 10           12ms  ✓  1h ago  │
│  2. UPDATE users SET active = true...       5ms  ✓  2h ago  │
│  3. SELECT * FROM nonexistent               -    ✗  2h ago  │
│  4. INSERT INTO logs (msg) VALUES...        8ms  ✓  3h ago  │
│                                                             │
│  [Enter] re-run   [v] view results   [/] search             │
└─────────────────────────────────────────────────────────────┘
```

- `✓` indicates successful queries
- `✗` indicates failed queries
- Select an entry and press Enter to re-run it


### Searching History

Press `/` in the history view to search:

```
Search: users

┌─ Query History (filtered) ──────────────────────────────────┐
│                                                             │
│  1. SELECT * FROM users LIMIT 10           12ms  ✓  1h ago  │
│  2. UPDATE users SET active = true...       5ms  ✓  2h ago  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


### Viewing Saved Results

Select a history entry and press `v` to view the full results from when the query ran. Results are stored compressed, so you can review query output even after the data has changed.


## Tab Completion

Press Tab while typing to auto-complete:

- **Table names** - Type `SEL` then Tab to see suggestions
- **Column names** - After typing a table name, Tab shows its columns

```
noorm> SELECT * FROM us[Tab]
                      users
                      user_roles
                      user_sessions
```

Tab completion pulls from your database schema, so it knows your actual tables and columns.


## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Execute query |
| `Up` / `Down` | Navigate command history |
| `Tab` | Auto-complete table/column names |
| `Ctrl+C` | Clear current input |
| `Escape` | Exit terminal |
| `h` | Open history viewer |
| `c` | Clear history |


## Clearing History

Press `c` from the terminal to open the clear menu:

```
┌─ Clear History ─────────────────────────────────────────────┐
│                                                             │
│  1. Older than 1 month                                      │
│  2. Older than 3 months                                     │
│  3. Clear all history                                       │
│                                                             │
│  History: 47 entries, 2.3 MB stored                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Select an option to remove old entries and free up space. Results files are deleted along with their history entries.


## Tips

**Always use LIMIT** when exploring unfamiliar tables. A table with millions of rows will slow down your terminal.

**Preview before modifying** - Run a SELECT with your WHERE clause before executing UPDATE or DELETE:

```
noorm> SELECT id, email FROM users WHERE last_login < '2023-01-01';
-- Review the results
noorm> DELETE FROM users WHERE last_login < '2023-01-01';
```

**History is not encrypted** - Query text and results are stored in plaintext (gzipped). Avoid running queries that contain sensitive data like passwords or API keys.


## What's Next?

- [Schema Explorer](/guide/database/explore) - Browse tables, views, and other database objects
- [Configs](/guide/environments/configs) - Switch between different databases
- [Execution](/guide/sql-files/execution) - Run SQL files with change detection

# First Build


This tutorial takes about 5 minutes. By the end, you'll understand the core value of noorm: **change detection**.


## What You'll Do

1. Create a SQL file
2. Run build
3. Modify the file
4. Run build again—see only the changed file execute


## Prerequisites

- noorm installed ([Installation Guide](/getting-started/installation))
- A database to connect to (SQLite works for this tutorial)


## Step 1: Initialize Your Project

```bash
mkdir noorm-tutorial
cd noorm-tutorial
noorm init
```

You'll see the TUI launch with a setup wizard. For this tutorial, choose:

- **Dialect**: SQLite (easiest for quick testing)
- **Database path**: `./data/tutorial.db`
- **Config name**: `dev`

After setup, your project looks like this:

```
noorm-tutorial/
├── .noorm/
│   ├── settings.yml       # Project settings (commit this)
│   └── state.enc          # Encrypted state (don't commit)
├── sql/                   # Your SQL files go here
└── changes/               # Versioned migrations go here
```


## Step 2: Create Your First SQL File

```bash
mkdir -p sql/tables
```

Create `sql/tables/users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```


## Step 3: Run Build

```bash
noorm run build
```

Or launch the TUI and press `r` → select "build":

```bash
noorm
```

Output:

```
Building schema...

✓ sql/tables/users.sql

Executed: 1
Skipped:  0
```

The table now exists in your database. noorm recorded that this file ran, including a checksum of its contents.


## Step 4: Run Build Again

```bash
noorm run build
```

Output:

```
Building schema...

• sql/tables/users.sql (unchanged)

Executed: 0
Skipped:  1
```

Nothing ran. noorm knows the file hasn't changed since last execution.


## Step 5: Modify the File

Add a column to `sql/tables/users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    bio TEXT,                                    -- Added this line
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```


## Step 6: Run Build One More Time

```bash
noorm run build
```

Output:

```
Building schema...

✓ sql/tables/users.sql

Executed: 1
Skipped:  0
```

noorm detected the change and re-ran the file.


## What Just Happened?

noorm uses **checksums** to track file changes:

1. Before executing a file, noorm computes its SHA-256 hash
2. After execution, it stores the hash in the database
3. On subsequent runs, it compares current hash to stored hash
4. If they match, the file is skipped
5. If they differ, the file is executed and the new hash is stored

This means:
- Reordering lines? File runs again.
- Adding a comment? File runs again.
- No changes? Nothing runs.

::: tip Why This Matters
In a schema with 50+ files, you don't want to re-run everything on each build. noorm runs only what changed, saving time and avoiding unnecessary database churn.
:::


## Bonus: Add More Files

Create `sql/tables/posts.sql`:

```sql
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Create `sql/views/recent_posts.sql`:

```sql
CREATE VIEW IF NOT EXISTS recent_posts AS
SELECT p.*, u.name as author_name
FROM posts p
JOIN users u ON p.user_id = u.id
WHERE p.created_at > datetime('now', '-7 days');
```

Run build:

```bash
noorm run build
```

Output:

```
Building schema...

• sql/tables/users.sql (unchanged)
✓ sql/tables/posts.sql
✓ sql/views/recent_posts.sql

Executed: 2
Skipped:  1
```

Only the new files ran. The unchanged `users.sql` was skipped.


## Force Re-Run

Sometimes you want to re-run everything regardless of changes:

```bash
noorm run build --force
```

Or in the TUI, use the force option when prompted.


## What's Next?

You've seen the core mechanic. Now explore:

- [Concepts](/getting-started/concepts) - Understand the mental model
- [TUI Quick Reference](/tui) - Navigate the terminal interface
- [SQL Templates](/guide/sql-files/templates) - Dynamic SQL generation

# First Build


This tutorial takes about 5 minutes. By the end, you'll understand how noorm separates **schema definition** from **schema evolution**.


## What You'll Do

1. Initialize a project and configure a database
2. Create SQL files and build your schema
3. Evolve the schema with a change
4. Create a fresh test database to see you don't need migrations


## Prerequisites

- noorm installed ([Installation Guide](/getting-started/installation))
- A PostgreSQL database to connect to


## Step 1: Initialize Your Project

```bash
mkdir noorm-tutorial
cd noorm-tutorial
noorm init
```

This creates the project structure:

```
noorm-tutorial/
├── .noorm/
│   ├── settings.yml       # Project settings (commit this)
│   └── state.enc          # Encrypted state (don't commit)
├── sql/                   # Your SQL files go here
└── changes/               # Versioned changes go here
```


## Step 2: Add a Database Config

Launch the TUI:

```bash
noorm
```

Press `c` for config, then `a` to add a new config. Fill out the form:

- **Config Name**: `dev`
- **Database Type**: PostgreSQL (use arrow keys to select)
- **Host**: `localhost`
- **Port**: `5432`
- **Database**: `noorm_dev`
- **Username**: `postgres`
- **Password**: your password

Leave the SQL Path and Changes Path at their defaults (`./sql` and `./changes`). Submit the form to save your config.


## Step 3: Create the Database

Back at the home screen, press `d` for Database. You'll see the Database Operations screen:

```
Database Operations

Config:      dev
Connection:  CONNECTED

Available Actions

[c] Create - Build database from SQL files
[d] Destroy - Drop all managed objects
[x] Explore - Browse database schema
[w] Wipe - Truncate table data (keep schema)
[t] Teardown - Drop user objects (keep noorm)
```

Press `c` to create. noorm will create the `noorm_dev` database on your PostgreSQL server and initialize its tracking tables.

::: tip No SQL Files Yet?
That's fine! At this point we're just creating the empty database and noorm's internal tracking tables. We'll add SQL files next.
:::


## Step 4: Configure Build Settings

Open `.noorm/settings.yml` and define which folders to include:

```yaml
paths:
  sql: ./sql
  changes: ./changes

build:
  include:
    - 01_tables
```

The `include` array filters which folders are included in builds. Folder names are relative to your `paths.sql` directory.

::: warning Execution Order
Files and directories run in **alphanumeric order**. Without numeric prefixes:

```
sql/functions/   ← runs first (alphabetically)
sql/tables/      ← runs second
sql/views/       ← runs third
```

That's wrong—tables should exist before views reference them. Use numeric prefixes:

```
sql/01_tables/   ← runs first
sql/02_views/    ← runs second
sql/03_functions/ ← runs third
```

This rule applies everywhere: directories, files within directories, change scripts. One mental model for everything.
:::


## Step 5: Create Your First SQL File

Create the users table:

```bash
mkdir -p sql/01_tables
```

Create `sql/01_tables/001_users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);
```


## Step 6: Run Build

```bash
noorm -H run build
```

Output:

```
• build:start    Starting schema build (1 files)
• file:after     Executed sql/01_tables/001_users.sql (12ms)
• log            Build completed successfully  filesRun=1 filesSkipped=0
```

Your users table now exists.


## Step 7: Evolve the Schema

Now you want to expand the schema: add a `bio` column to users, create a posts table, and add a view.

First, **update your SQL files** to reflect the new ideal state.

Edit `sql/01_tables/001_users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    bio TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

Create `sql/01_tables/002_posts.sql`:

```sql
CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

Create `sql/02_views/001_recent_posts.sql`:

```bash
mkdir -p sql/02_views
```

```sql
CREATE OR REPLACE VIEW recent_posts AS
SELECT p.*, u.name as author_name
FROM posts p
JOIN users u ON p.user_id = u.id
WHERE p.created_at > NOW() - INTERVAL '7 days';
```

Since you added views, **update your settings** to include the new folder:

```yaml
build:
  include:
    - 01_tables
    - 02_views
```

The `02_` prefix ensures views run after tables—important since views reference tables.

Your SQL files now represent the complete, ideal schema. But the dev database still only has the old users table.


## Step 8: Create a Change

Use the TUI to create a change:

```bash
noorm
```

Press `g` for changes, then `a` to add a new change. Enter a name like `add-posts-and-bio`.

The TUI creates the folder structure and shows:

```
✓ Change "2024-01-15-add-posts-and-bio" created!
Created folder structure with template files.

[e] Edit in editor  [any] Back to list
```

Press `e` to open the change folder in your editor, or navigate to it manually. Add these files:

`changes/2024-01-15-add-posts-and-bio/change/001_add_bio.sql`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
```

Changes should be idempotent—safe to run on any database state. PostgreSQL's `IF NOT EXISTS` ensures this won't error if the column already exists.

`changes/2024-01-15-add-posts-and-bio/change/002_schema.txt`:

```
01_tables/002_posts.sql
02_views/001_recent_posts.sql
```

The `.txt` file references your SQL files. When the change runs, it executes those files from your `sql/` directory.


## Step 9: Apply the Change

```bash
noorm -H change ff
```

Output:

```
• change:start   Applying 2024-01-15-add-posts-and-bio
• file:after     Executed 001_add_bio.sql (8ms)
• file:after     Executed 01_tables/002_posts.sql (15ms)
• file:after     Executed 02_views/001_recent_posts.sql (6ms)
• change:after   Applied 2024-01-15-add-posts-and-bio
• log            Changes applied successfully  applied=1 skipped=0
```

Your dev database now matches your SQL files.


## Step 10: Fresh Database (No Migrations Needed)

Now create a test database to see the other path. In the TUI:

1. Press `c` for Configurations, then `a` to add a new config named `test` pointing to `noorm_test`
2. Use arrow keys to select the `test` config and press `Enter` to switch to it
3. Press `d` for Database, then `c` to create the database
4. Press `r` for Run SQL, then `b` for Build

If you already have a test config and database set up, you can do this in headless mode:

```bash
noorm -H config use test
noorm -H run build
```

Output:

```
• build:start    Starting schema build (3 files)
• file:after     Executed sql/01_tables/001_users.sql (14ms)
• file:after     Executed sql/01_tables/002_posts.sql (11ms)
• file:after     Executed sql/02_views/001_recent_posts.sql (7ms)
• log            Build completed successfully  filesRun=3 filesSkipped=0
```

The test database has the complete schema from your SQL files. No changes needed—they're only for evolving existing databases.


## What Just Happened?

You experienced both paths:

| Scenario | Command | What Runs |
|----------|---------|-----------|
| Fresh database | `noorm run build` | SQL files |
| Existing database | `noorm change ff` | Changes |

Your SQL files are the source of truth. Changes are the changelog of how you evolved existing databases to match them.

::: tip The Workflow
1. Update your SQL files to reflect the ideal schema
2. Create a change to evolve existing databases
3. Fresh databases just run build—no migration history needed
:::


## What's Next?

- [Concepts](/getting-started/concepts) - Understand the full mental model
- [Building Your SDK](/getting-started/building-your-sdk) - Wrap noorm in a TypeScript SDK for your apps
- [TUI Quick Reference](/tui) - Navigate the terminal interface
- [Changes Guide](/guide/changes/overview) - Versioned changes in depth

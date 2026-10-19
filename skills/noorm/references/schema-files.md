# Schema Files and Changes


Where SQL goes in a noorm project and why. Read this before adding a table, altering a column, writing seed data, or creating a change.


## Table of Contents

1. [Layout](#layout)
2. [What each directory is for](#what-each-directory-is-for)
3. [Which directory gets this edit](#which-directory-gets-this-edit)
4. [Anatomy of a change](#anatomy-of-a-change)
5. [Manifests](#manifests)
6. [Templates](#templates)
7. [Workflow for a schema edit](#workflow-for-a-schema-edit)
8. [Worked example](#worked-example)
9. [Checks before you finish](#checks-before-you-finish)


---


## Layout


    project/
    ├── .noorm/
    │   └── settings.yml     # paths.sql, paths.changes, build.include/exclude
    └── db/
        ├── sql/             # what the schema IS: the current state
        ├── changes/         # how an EXISTING database gets to that state
        ├── AGENTS.md        # the user's steering for this directory; read it first
        └── CLAUDE.md        # imports AGENTS.md


`noorm init` writes `paths.sql: ./db/sql` and `paths.changes: ./db/changes` into `.noorm/settings.yml`. Projects created before that use `./sql` and `./changes`, and a settings file with no `paths` key falls back to those.

Read `.noorm/settings.yml` before creating or moving a file. Never create a second `sql/` or `changes/` beside the configured ones: noorm does not read them, so their files never run.


---


## What each directory is for


| | `sql/` | `changes/` |
|---|---|---|
| Describes | What the schema is now | How a database that already exists gets there |
| Run by | `noorm run build` | `noorm change ff`, `change run`, `change revert` |
| Target | An empty database | A database in the state before the change |
| Executes | Every file whose rendered checksum changed, in sorted path order | Each change once, recorded in the database |
| Keeps history | No | Yes, that is its job |


### Rules for `sql/`

- Only statements that create the current state: `CREATE TABLE`, `CREATE OR REPLACE` views, functions, procedures and triggers (`CREATE OR ALTER` on mssql), `CREATE INDEX`, seed `INSERT`s, grants.
- Declare each column and constraint once, inline in its `CREATE TABLE`. Adding a column means editing that statement.
- Never put in `sql/`:
    - `ALTER` of a table this directory creates
    - `DROP`, or a file that exists only to retire an object
    - `UPDATE` or backfills of existing rows
    - `IF NOT EXISTS` / `DROP IF EXISTS` guards added to survive a second run
    - comments about history ("added in v2")

A table whose definition is spread over a `CREATE` and later `ALTER`s cannot be read without replaying them. A guard is worse: when the `CREATE TABLE` file changes, `build` re-runs it, and `CREATE TABLE IF NOT EXISTS` against the existing table does nothing, so the edit silently never lands.

`sql/` is for fresh databases: CI, tests, a new developer's machine. Do not run `noorm run build` against a database that already holds data. A changed `CREATE TABLE` file re-executes against the existing table, where it either errors or no-ops and never alters anything. Existing databases move with `noorm change ff`.


### Rules for `changes/`

- Everything that turns an existing database into the current state: `ALTER`, `DROP`, backfills, data fixes, type changes, index and constraint additions on live tables.
- Make every statement safe to run twice (`ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`, `CREATE ... IF NOT EXISTS`). `noorm run build` records no change history, so the first `change ff` on a freshly built database replays every change in the folder, and a statement that is not safe to run twice fails there.
- Write a `revert/` for each change.
- Never edit a change that has been applied anywhere. Databases that already ran it keep the old body and the rest run the new one, so environments drift apart. Add a new change instead. `change ff` skips applied changes; `noorm change run <name>` re-executes an edited one on the one database you point it at.


---


## Which directory gets this edit


Every edit to `sql/` that changes what a built database contains ships with a change that brings an already-built database to the same state. Edit `sql/` first (the target), then write the change.


| Edit | `sql/` | `changes/<name>/change/` |
|---|---|---|
| New table | `CREATE TABLE` | The same `CREATE TABLE IF NOT EXISTS`, inline. Do not reference the table's file from a manifest |
| New column | Add it to that table's `CREATE TABLE` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, plus a backfill if rows need a value |
| Drop or rename a column | Remove or rename it in the `CREATE TABLE` | `ALTER TABLE ... DROP / RENAME COLUMN` |
| New or edited view, function, procedure, trigger | Edit its `CREATE OR REPLACE` file | A `.txt` manifest naming that file |
| New index | `CREATE INDEX` | `CREATE INDEX IF NOT EXISTS` |
| New seed row | Add it to the seed file or its data file | An idempotent `INSERT` for the rows existing databases lack |
| Bad data in existing rows | Nothing | `UPDATE` |
| Remove an object | Delete its file | `DROP ... IF EXISTS` |


---


## Anatomy of a change


    db/changes/2026-10-19-add-user-bio/
    ├── change/
    │   ├── 001_add-bio-column.sql
    │   └── 002_rebuild-views.txt
    ├── revert/
    │   └── 001_drop-bio-column.sql
    └── changelog.md


- Scaffold with `noorm change add <description>`. It creates the dated folder under `paths.changes` with comment-only stubs. Replace the comments with SQL.
- `change/` and `revert/` hold `.sql`, `.sql.tmpl` and `.txt` files. They run in filename order, so keep the `NNN_` prefix zero-padded to three digits.
- `revert/` also runs in forward order (`001`, then `002`). Number the revert files in the order the undo has to happen.
- `changelog.md` says why the change exists. The diff already shows what it does.
- A change whose files contain only comments or placeholders is rejected.


---


## Manifests


A `.txt` file in `change/` or `revert/` runs existing `sql/` files in place instead of copying their SQL into the change.


    # db/changes/2026-10-19-widen-name/change/003_rebuild-views.txt
    views/active_users.sql
    functions/get_user_stats.sql


- One path per line, relative to `paths.sql` (`views/active_users.sql`, not `db/sql/views/active_users.sql`). Blank lines and lines starting with `#` are ignored.
- Lines run in file order. The manifest sorts among the other change files by filename, so `001_rebuild.txt` runs before `002_alter.sql`.
- A missing file fails `noorm change run <name>` with a `ManifestReferenceError`. `noorm change ff` and `change list` skip a change they cannot parse, still exit 0, and the change is absent from `change list`. A manifest with no path lines is treated the same way.
- A manifest runs the referenced file's current content, not its content when the change was written. A change still pending on a lagging database, or replayed after a build, executes today's definition.
- Because of that, reference only objects that are safe to run repeatedly: `CREATE OR REPLACE` views, functions, procedures, triggers. Never reference a `CREATE TABLE` file: replayed, it hits a table that already exists.
- A path listed more than once across a change's manifests runs once, at its first position.
- A manifest in `revert/` rebuilds the current `sql/` definition. It cannot restore an older definition of a view or function; write that older `CREATE OR REPLACE` inline in the revert file.


Use a manifest whenever a change has to re-create an object that `sql/` already defines. Copying the DDL into the change leaves two definitions that drift apart.


A table change that a dependent view blocks:


    change/
    ├── 001_drop-dependent-views.sql     # DROP VIEW IF EXISTS active_users;
    ├── 002_widen-name-column.sql        # ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(200);
    └── 003_rebuild-views.txt            # views/active_users.sql


---


## Templates


A `.sql.tmpl` file is rendered by Eta before it runs, with any `.json`, `.yml`, `.csv` or `.dt` file in the same directory loaded onto `$`. Syntax, helpers and context are in `references/templates.md`.

Reach for a template when any of these holds:

| Situation | Template shape |
|---|---|
| Rows come from data: lookups, enums, roles, feature flags, cron schedules | Keep the data in `roles.yml` beside the template and loop over `$.roles` |
| Three or more statements differ only by a name or value: grants, audit triggers, per-table indexes | Loop over a list in a data file, or call a function from `$helpers.ts` |
| A value differs by environment: stage, test flag, host | Branch on `$.config.stage` / `$.config.isTest`, or read `$.env` |
| A value is secret | Read `$.secrets.KEY`. Never write a secret into a plain `.sql` file |
| The same fragment appears in several files | `$.include()` it |

Use plain `.sql` when none applies. A template with no variables is noise.

- Quote every interpolated value with `$.quote()`. Data files are not trusted input.
- Templates work in `sql/` and in `change/` and `revert/`. In a change folder a template reads the data files beside it, and those `.json`, `.yml` and `.csv` files are not run as change files.
- In `sql/` the checksum covers the rendered output, so editing a data file re-runs the template on the next build. `$.now()` and `$.uuid()` change the output every build, so a file that calls them runs every build. A change's data files sit outside the change's checksum.
- Check the output with `noorm run preview <file>` before running it.


A hand-written list like this:


    INSERT INTO role (name) VALUES ('admin');
    INSERT INTO role (name) VALUES ('editor');
    INSERT INTO role (name) VALUES ('viewer');


becomes data plus a template:


    # db/sql/10_seeds/roles.yml
    - admin
    - editor
    - viewer

    -- db/sql/10_seeds/001_roles.sql.tmpl
    -- {% for (const name of $.roles) { %}
    INSERT INTO role (name) VALUES ({%~ $.quote(name) %});
    -- {% } %}


---


## Workflow for a schema edit


1. Read `.noorm/settings.yml` for `paths.sql` and `paths.changes`. Read `db/AGENTS.md` for the user's own rules.
2. Edit the target state in `sql/`. Columns and constraints go inline in `CREATE TABLE`.
3. `noorm change add <description>` to scaffold the change folder.
4. Write `change/NNN_*.sql`: the `ALTER`s, backfills and guards that move an existing database to the new `sql/` state.
5. Re-create dependent views, functions, procedures and triggers with a `.txt` manifest, not a copy.
6. Write `revert/NNN_*.sql` that undoes the change, numbered in the order the undo runs.
7. Fill in `changelog.md`.
8. Verify (see below), then commit `sql/` and the change together.


---


## Worked example


Add a `bio` column to `users`.


    -- db/sql/01_tables/001_users.sql
    CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT ''
    );


    -- db/changes/2026-10-19-add-user-bio/change/001_add-bio-column.sql
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';


    -- db/changes/2026-10-19-add-user-bio/revert/001_drop-bio-column.sql
    ALTER TABLE users DROP COLUMN IF EXISTS bio;


    # db/changes/2026-10-19-add-user-bio/changelog.md
    Profiles need a short bio. Default is empty so existing rows stay valid.


The `ALTER` is in the change and the column is declared once, inline, in `sql/`. The reverse placements are the usual mistake: the `ALTER` in `sql/`, or the column only in the change.


---


## Checks before you finish


- A fresh database built from `sql/` and a database built from the previous commit then moved with `noorm change ff` end up with the same schema. This is the test of the pairing rule.
- `noorm run build --dry-run` and `noorm change ff --dry-run` render every file, templates and manifests included, to `tmp/` and execute nothing. `change ff --dry-run` still reads the change tracking tables to decide what is pending.
- `sql/` contains no `ALTER`, `DROP`, backfill or guard that you added for this edit.
- No `CREATE OR REPLACE` object was copied into a change when a manifest would do.
- Seed lists, grants and repeated statements went through a template.
- No file landed outside the configured `paths`.
- The change appears in `noorm change list`. A broken manifest makes `ff` skip the change and still exit 0.

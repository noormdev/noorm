# Organizing SQL Files


How you structure your SQL files determines how they execute. noorm processes files in alphabetical order by path, so a well-organized directory structure gives you predictable, repeatable builds.


## Recommended Directory Structure

Start with this layout:

```
sql/
├── tables/
│   ├── 001_users.sql
│   ├── 002_posts.sql
│   └── 003_comments.sql
├── views/
│   ├── 001_active_users.sql
│   └── 002_recent_posts.sql
├── functions/
│   └── 001_calculate_score.sql
└── seeds/
    └── 001_default_roles.sql
```

This structure works because:

- **Numbered prefixes** - Guarantee execution order within each folder
- **Logical grouping** - Easy to find and maintain related files
- **Folder prefixes control order** - Without prefixes, `functions/` would run before `tables/` (alphabetically). See [Execution Order](#execution-order) below.


## Naming Conventions

noorm doesn't enforce naming rules, but consistent naming makes life easier.


### Use Numeric Prefixes for Order

Files execute alphabetically. Without prefixes, `accounts.sql` runs before `users.sql`—even if users should exist first.

```
# Without prefixes (unpredictable)
accounts.sql      # Runs first (a < u)
users.sql         # Runs second

# With prefixes (explicit order)
001_users.sql     # Runs first
002_accounts.sql  # Runs second
```

Recommended formats:

| Format | Example | Best For |
|--------|---------|----------|
| `001_` | `001_users.sql` | Most projects (up to 999 files per folder) |
| `01_` | `01_users.sql` | Smaller projects (up to 99 files) |
| `0001_` | `0001_users.sql` | Large projects with many files |


### Use Descriptive Names

The name should tell you what the file does without opening it:

```
# Good
001_create_users.sql
002_add_user_indexes.sql
003_create_posts.sql

# Avoid
001.sql
002_update.sql
users_v2_final_FINAL.sql
```


### Template Files

Files ending in `.sql.tmpl` are processed through the template engine before execution:

```
seeds/
├── 001_default_roles.sql          # Static SQL
└── 002_environment_config.sql.tmpl # Dynamic SQL with variables
```


## Execution Order

noorm processes files in **alphabetical order by full path**. This is the critical rule for understanding how your schema executes. This means:

1. Folders are sorted first
2. Files within each folder are sorted second

```
sql/
├── functions/          # f comes before t
│   └── 001_helpers.sql
├── tables/             # t comes before v
│   ├── 001_users.sql
│   └── 002_posts.sql
└── views/              # v is last
    └── 001_summary.sql
```

Execution order:
1. `sql/functions/001_helpers.sql`
2. `sql/tables/001_users.sql`
3. `sql/tables/002_posts.sql`
4. `sql/views/001_summary.sql`

::: tip
If you need tables before functions, prefix your folders: `01_tables/`, `02_functions/`, `03_views/`.
:::


## Using Settings for Build Order

The `settings.yml` file lets you control which folders run and in what order:

```yaml
build:
    include:
        - sql/tables      # Runs first
        - sql/views       # Runs second
        - sql/functions   # Runs third
        - sql/seeds       # Runs last
    exclude:
        - sql/archive     # Never runs
```

The `include` array defines execution order. Folders listed first execute first, regardless of alphabetical ordering.


### Conditional Includes with Rules

Different environments often need different files. Use rules to include or exclude folders based on config properties:

```yaml
rules:
    # Only run seeds in test environments
    - match:
          isTest: true
      include:
          - sql/seeds
          - sql/test-fixtures

    # Skip heavy seeds for CI
    - match:
          name: ci-test
      exclude:
          - sql/seeds/large-dataset.sql
```

This means:
- Production builds skip test data entirely
- CI builds skip slow seed files
- Development gets everything


## Organizing by Feature vs by Type

There are two common approaches to organizing SQL files.


### By Type (Recommended for Most Projects)

Group files by what they are:

```
sql/
├── tables/
├── views/
├── functions/
├── procedures/
└── seeds/
```

**Pros:**
- Clear execution order (tables before views)
- Easy to set up include order in settings
- Matches how databases organize objects

**Cons:**
- Related files are spread across folders


### By Feature (For Large Projects)

Group files by what they relate to:

```
sql/
├── auth/
│   ├── 01_tables/
│   ├── 02_views/
│   └── 03_functions/
├── billing/
│   ├── 01_tables/
│   ├── 02_views/
│   └── 03_functions/
└── core/
    ├── 01_tables/
    └── 02_views/
```

**Pros:**
- Related files stay together
- Teams can own specific folders

**Cons:**
- Need numbered subfolders to maintain order
- More complex include configuration


### Hybrid Approach

Combine both when it makes sense:

```
sql/
├── 01_core/
│   ├── tables/
│   └── views/
├── 02_features/
│   ├── auth/
│   └── billing/
└── 03_seeds/
```


## Common Patterns


### Separating DDL and DML

Keep schema definitions separate from data operations:

```
sql/
├── ddl/              # CREATE, ALTER statements
│   ├── tables/
│   └── views/
└── dml/              # INSERT, UPDATE statements
    └── seeds/
```


### Environment-Specific Files

Use rules to include environment-specific folders:

```
sql/
├── tables/
├── views/
├── seeds-dev/        # Development data
├── seeds-staging/    # Staging data
└── seeds-prod/       # Production defaults only
```

```yaml
rules:
    - match:
          name: dev
      include:
          - sql/seeds-dev

    - match:
          name: staging
      include:
          - sql/seeds-staging

    - match:
          name: prod
      include:
          - sql/seeds-prod
```


### Archive Pattern

Keep old migrations without running them:

```
sql/
├── tables/
├── views/
└── archive/          # Old files, excluded from builds
    └── deprecated_table.sql
```

```yaml
build:
    exclude:
        - sql/archive
```


## What's Next?

Now that your files are organized:

- [Templates](/guide/sql-files/templates) - Add dynamic content to your SQL
- [Execution](/guide/sql-files/execution) - Understand builds and change detection
- [Settings](/guide/environments/stages) - Configure build order with settings.yml

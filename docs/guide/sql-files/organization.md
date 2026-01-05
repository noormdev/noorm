# Organizing SQL Files


How you structure your SQL files determines how they execute. noorm processes files in alphabetical order by path, so a well-organized directory structure gives you predictable, repeatable builds.


## Recommended Directory Structure

Start with this layout:

```
sql/
├── 01_tables/
│   ├── 001_users.sql
│   ├── 002_posts.sql
│   └── 003_comments.sql
├── 02_views/
│   ├── 001_active_users.sql
│   └── 002_recent_posts.sql
├── 03_functions/
│   └── 001_calculate_score.sql
└── 04_seeds/
    └── 001_default_roles.sql
```

This structure works because:

- **Numbered folder prefixes** - Guarantee execution order between folders (`01_` before `02_`)
- **Numbered file prefixes** - Guarantee execution order within each folder
- **Logical grouping** - Easy to find and maintain related files


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

Without numeric folder prefixes, alphabetical order causes problems:

```
sql/
├── functions/          # f comes before t—runs first!
│   └── 001_helpers.sql
├── tables/             # t comes after f—runs second
│   ├── 001_users.sql
│   └── 002_posts.sql
└── views/              # v is last
    └── 001_summary.sql
```

This is wrong—functions often depend on tables. Use numeric prefixes on folders:

```
sql/
├── 01_tables/          # runs first
│   ├── 001_users.sql
│   └── 002_posts.sql
├── 02_views/           # runs second
│   └── 001_summary.sql
└── 03_functions/       # runs third (can reference tables/views)
    └── 001_helpers.sql
```

Execution order:
1. `sql/01_tables/001_users.sql`
2. `sql/01_tables/002_posts.sql`
3. `sql/02_views/001_summary.sql`
4. `sql/03_functions/001_helpers.sql`


## Using Settings for Build Order

The `settings.yml` file lets you control which folders run and in what order:

```yaml
build:
    include:
        - 01_tables
        - 02_views
        - 03_functions
        - 04_seeds
    exclude:
        - archive         # Never runs
```

The `include` array is a **filter**—it controls which folders are included, not their order. Execution order is always alphanumeric. Use numeric prefixes to control the sequence:

```
sql/
├── 01_tables/    ← runs first
├── 02_views/     ← runs second
├── 03_functions/ ← runs third
├── 04_seeds/     ← runs last
└── archive/      ← excluded, never runs
```

This keeps the filesystem self-documenting. Anyone can see the execution order without consulting settings.


### Conditional Includes with Rules

Different environments often need different files. Use rules to include or exclude folders based on config properties:

```yaml
rules:
    # Only run seeds in test environments
    - match:
          isTest: true
      include:
          - sql/04_seeds
          - sql/05_test-fixtures

    # Skip heavy seeds for CI
    - match:
          name: ci-test
      exclude:
          - sql/04_seeds/003_large-dataset.sql
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
├── 01_tables/
├── 02_views/
├── 03_functions/
├── 04_procedures/
└── 05_seeds/
```

**Pros:**
- Clear execution order from numeric prefixes
- Filesystem is self-documenting
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
├── 01_ddl/              # CREATE, ALTER statements
│   ├── 01_tables/
│   └── 02_views/
└── 02_dml/              # INSERT, UPDATE statements
    └── 01_seeds/
```


### Environment-Specific Files

Use rules to include environment-specific folders:

```
sql/
├── 01_tables/
├── 02_views/
├── 03_seeds-dev/        # Development data
├── 03_seeds-staging/    # Staging data
└── 03_seeds-prod/       # Production defaults only
```

```yaml
rules:
    - match:
          name: dev
      include:
          - sql/03_seeds-dev

    - match:
          name: staging
      include:
          - sql/03_seeds-staging

    - match:
          name: prod
      include:
          - sql/03_seeds-prod
```


### Archive Pattern

Keep old files without running them:

```
sql/
├── 01_tables/
├── 02_views/
└── archive/          # Old files, excluded from builds
    └── deprecated_table.sql
```

```yaml
build:
    exclude:
        - archive
```


## What's Next?

Now that your files are organized:

- [Templates](/guide/sql-files/templates) - Add dynamic content to your SQL
- [Execution](/guide/sql-files/execution) - Understand builds and change detection
- [Settings](/guide/environments/stages) - Configure build order with settings.yml

# Template


## The Problem

Static SQL files work for simple schemas. But real projects need dynamic SQL:

- Generating DDL for multiple similar tables
- Seeding data from CSV files
- Conditional indexes based on database dialect
- Injecting secrets without hardcoding

You could write a custom Node.js script for each case. But then you're maintaining two systems - your SQL files and your generation scripts.

noorm solves this with `.tmpl` files. Any file ending in `.tmpl` is processed as a template before execution. Templates look like SQL with embedded logic. They auto-load data files, inherit helpers, and have access to secrets and config.


## How It Works

Templates use [Eta](https://eta.js.org/) with custom delimiters. Any `.sql.tmpl` file is processed before execution:

```
001_create_users.sql       → Executed as-is
002_seed_roles.sql.tmpl    → Rendered, then executed
```

When rendering, the engine:

1. Walks up the directory tree collecting `$helpers.ts` files
2. Scans the template's directory for data files (JSON5, YAML, CSV, DT) — skipping executable formats the template doesn't reference
3. Builds a context object (`$`) with helpers, data, config, and secrets
4. Strips `-- {% %}` directive lines, then renders with Eta
5. Returns the SQL string


## Template Syntax

noorm uses custom delimiters to avoid conflicts with SQL syntax:

| Syntax | Purpose |
|--------|---------|
| `{% %}` | JavaScript code block |
| `{%~ %}` | Output (raw) |
| `$` | Context variable |
| `-- {% %}` | Directive line — the whole line is stripped before Eta parses |

The `-- {% ... %}` form keeps a `.sql.tmpl` file valid SQL: directives look like comments to a SQL parser and to your editor's syntax highlighter. The engine strips the `-- ` prefix, trailing whitespace, and the line's newline before rendering, so the directive produces no output. It only matches lines where the tag is the *only* content — `SELECT 1; -- comment` and `-- {% if (x) { %} SELECT 1` are both left alone.

Eta's `autoTrim` is deliberately off; directive-line stripping handles whitespace instead. Enabling `autoTrim` would make `leftTrim` eat the newline after an interpolation tag, turning `{%~ item %}\nAS` into `itemAS`.

```sql
-- Loop over data
{% for (const role of $.roles) { %}
INSERT INTO roles (name) VALUES ('{%~ role %}');
{% } %}

-- Conditional
{% if ($.config.connection.dialect === 'postgres') { %}
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
{% } %}

-- Use helpers
INSERT INTO users (id) VALUES ('{%~ $.uuid() %}');
```


## Auto-Loading Data Files

Data files in the same directory as the template are automatically loaded into the context:

```
sql/users/
├── 001_seed.sql.tmpl     # Template
├── users.json5           # → $.users
├── roles.yml             # → $.roles
└── seed-data.csv         # → $.seedData
```

File names are converted to camelCase:

- `my-config.json5` → `$.myConfig`
- `seed_data.yml` → `$.seedData`
- `API_KEYS.json5` → `$.apiKeys`


### Supported Formats

| Extension | Loader | Result | Auto-loaded? |
|-----------|--------|--------|--------------|
| `.json`, `.json5` | JSON5 | Any (supports comments, trailing commas) | Yes |
| `.yaml`, `.yml` | YAML | Any | Yes |
| `.csv` | csv-parse | Array of row objects | Yes |
| `.dt`, `.dtz` | DT reader | Rows from a noorm data-transfer file | Yes |
| `.js`, `.mjs`, `.ts` | Dynamic import | Module default or exports | **Only when referenced** |
| `.sql` | Raw text | String | No — `.sql` is for `$.include()` only |

The json5, yaml, and csv parsers are lazy-imported on first use, so a project that never loads one of those formats never pulls its parser in.

`.dtzx` has no loader on purpose: a passphrase-encrypted transfer file cannot be decrypted from template context.


### Executable data files are not auto-loaded

`.js`, `.mjs`, and `.ts` files execute code when loaded. The engine loads one **only if the template's own source references its context key** — `$.seed` or `$['seed']`. Dropping a script next to a SQL file no longer gets it run.

```sql
-- seed.ts sits in this directory but is never imported: the template
-- does not mention $.seed, so nothing executes.
SELECT 1;
```

The reference check is syntactic and narrow by design. A false negative costs the author one explicit `$.key` reference; a false positive would re-open the hole where `run preview`, `run inspect`, and `--dry-run` — the three commands whose entire point is *not* to act — silently ran arbitrary code.


### JSON5 Features

JSON5 is a superset of JSON that's easier to write by hand:

```json5
// Comments are allowed
{
    name: 'unquoted keys',
    trailing: 'commas are fine',
    multi: 'line \
strings work',
}
```


## Helper Inheritance

Helper files named `$helpers.ts` or `$helpers.js` are automatically loaded. They're inherited up the directory tree - child helpers override parent helpers.

```
sql/
├── $helpers.ts                  # Project-wide helpers
├── users/
│   ├── $helpers.ts              # Overrides/extends parent
│   ├── 001_create.sql.tmpl      # Has access to both
│   └── roles.json5
└── products/
    └── 001_create.sql.tmpl      # Only has project-wide helpers
```

**Resolution order** (later overrides earlier):

1. Project root `$helpers.ts`
2. Parent directories `$helpers.ts`
3. Template's directory `$helpers.ts`


### Writing Helpers

```typescript
// sql/$helpers.ts
export function padId(id: number, length = 6): string {

    return String(id).padStart(length, '0')
}

export function formatDate(date: Date): string {

    return date.toISOString().split('T')[0]
}

export const constants = {
    MAX_RETRIES: 3,
    DEFAULT_TIMEOUT: 5000,
}
```

Use in templates:

```sql
INSERT INTO users (id, created_at) VALUES
    ('{%~ $.padId(1) %}', '{%~ $.formatDate(new Date()) %}');
```


## Template Context

The `$` object contains everything available in templates:

| Property | Description |
|----------|-------------|
| `$.<helper>` | Functions from inherited `$helpers.ts` files |
| `$.<filename>` | Auto-loaded data from co-located files (data files override helpers of the same name) |
| `$.config` | Active configuration object — **omitted** when a `config.*` data file sits in the template's directory, which takes the key instead |
| `$.secrets` | Decrypted secrets for active config. Reading an unresolved key throws `MissingSecretError` naming the key and the tiers searched (config-local, global-local, vault) — see [Secret Access](#secret-access). |
| `$.globalSecrets` | Decrypted global secrets |
| `$.env` | Environment variables |


### Secret Access

`$.secrets` is a `Proxy`, not a plain object (`src/core/template/context.ts`). Its `get` trap
throws on any key not present in the merged result; its `has` trap does not, so `in` is the
only safe way to check for an optional secret before reading it:

```typescript
'API_KEY' in $.secrets       // false — does not throw
$.secrets.API_KEY            // throws MissingSecretError if unresolved
$.secrets.API_KEY ?? 'x'     // still throws — `??` evaluates the left operand first
'API_KEY' in $.secrets ? $.secrets.API_KEY : 'x'   // the correct optional-read form
```

`Object.keys`, object spread, and `JSON.stringify` never trigger `get` for an absent key —
they resolve through `ownKeys`/`getOwnPropertyDescriptor`, which the proxy leaves at the
default (forwarded to the underlying record) — so none of them throw.

`sqlQuote` (`src/core/template/utils.ts`) throws `UndefinedSqlValueError` on `undefined` for
the same reason: an `undefined` reaching SQL rendering is always an upstream bug (a missing
secret, a bad lookup), never an intentional value. `null` is unaffected and still quotes to
`NULL`.


### Built-in Helpers

| Helper | Description |
|--------|-------------|
| `$.include(path)` | Include another SQL file |
| `$.escape(value)` | SQL-escape a string (doubles single quotes) |
| `$.quote(value)` | Escape and wrap in single quotes |
| `$.json(value)` | JSON stringify |
| `$.now()` | Current ISO timestamp |
| `$.uuid()` | Generate UUID v4 |


## Common Patterns


### Role-Based Permissions

Define users, roles, and permissions in YAML - generate all the grants from config:

```yaml
# sql/Auth/auth.yml
users:
    - username: __web_app
      password: $DB_WEB_APP_PASSWORD
    - username: __worker
      password: $DB_WORKER_PASSWORD

roles:
    - WebApp
    - Worker
    - AuthenticatedUser

permissions:
    WebApp:
        Members:
            - __web_app
        Views:
            - Web_MyProfile_V
            - Web_Settings_V
        Procs:
            - Login_trx
            - SignUp_trx

    Worker:
        Members:
            - __worker
        Views:
            - Worker_Queue_V
        Procs:
            - ProcessQueue_trx
```

```sql
-- sql/Auth/02-Permissions.sql.tmpl
{% for (const role in $.auth.permissions) { %}
{% const perms = $.auth.permissions[role] %}

-- Grant view access for {%~ role %}
{% for (const view of perms.Views || []) { %}
GRANT SELECT ON [{%~ view %}] TO [{%~ role %}];
{% } %}

-- Grant proc access for {%~ role %}
{% for (const proc of perms.Procs || []) { %}
GRANT EXECUTE ON [{%~ proc %}] TO [{%~ role %}];
{% } %}

{% } %}
```


### SQL Server Agent Jobs

Manage cron jobs from a config file - no more clicking through SSMS:

```yaml
# sql/Crons/cron.yml
Jobs:
    Sync_Entrata:
        Description: 'Sync property data from Entrata API'
        Steps:
            - name: Dispatch Sync
              command: 'EXEC Cron_Sync_Entrata_trx'

    Generate_Report:
        Description: 'Generate daily pricing report'
        Steps:
            - name: Generate Report
              command: 'EXEC Cron_GenReport_trx'

Schedules:
    EveryHour:
        time: '000000'
        frequency: Daily
        subday_frequency: Hours
        subday_interval: 1
        jobs:
            - Sync_Entrata

    DailyAt7PM:
        time: '190000'
        frequency: Daily
        jobs:
            - Generate_Report
```

```sql
-- sql/Crons/Crons.sql.tmpl

-- Create jobs
{% for (const job in $.cron.Jobs) { %}
EXEC msdb.dbo.sp_add_job
    @job_name = '{%~ job %}',
    @description = '{%~ $.cron.Jobs[job].Description %}',
    @enabled = 1

{% for (const step of $.cron.Jobs[job].Steps) { %}
EXEC msdb.dbo.sp_add_jobstep
    @job_name = '{%~ job %}',
    @step_name = '{%~ step.name %}',
    @subsystem = 'TSQL',
    @command = '{%~ step.command %}'
{% } %}
{% } %}

-- Attach schedules to jobs
{% for (const schedule in $.cron.Schedules) { %}
{% for (const job of $.cron.Schedules[schedule].jobs || []) { %}
EXEC msdb.dbo.sp_attach_schedule
    @job_name = '{%~ job %}',
    @schedule_name = '{%~ schedule %}'
{% } %}
{% } %}
```


### Seeding from CSV

```sql
-- sql/seed/users.sql.tmpl
INSERT INTO users (email, name, role) VALUES
{% $.users.forEach((user, i) => { %}
    ({%~ $.quote(user.email) %}, {%~ $.quote(user.name) %}, {%~ $.quote(user.role) %}){% if (i < $.users.length - 1) { %},{% } %}
{% }); %}
```

With `users.csv`:

```csv
email,name,role
alice@example.com,Alice,admin
bob@example.com,Bob,user
```


### Using Secrets

```sql
-- sql/config/api_keys.sql.tmpl
INSERT INTO config (key, value) VALUES
    ('stripe_key', '{%~ $.secrets.STRIPE_KEY %}'),
    ('api_url', '{%~ $.env.API_URL || 'https://api.example.com' %}');
```


### Including Fragments

```sql
-- changes/2025-01-15-full-setup/change/001_full_setup.sql.tmpl

-- Common functions
{%~ await $.include('../lib/uuid_function.sql') %}

-- Audit triggers
{%~ await $.include('../lib/audit_triggers.sql') %}

-- Tables
{%~ await $.include('./tables.sql') %}
```


### Dialect-Specific SQL

```sql
-- sql/indexes/create.sql.tmpl
CREATE INDEX idx_users_email ON users(email);

{% if ($.config.connection.dialect === 'postgres') { %}
-- PostgreSQL-specific: functional index
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
{% } %}

{% if ($.config.connection.dialect === 'mysql') { %}
-- MySQL-specific: prefix index for long columns
CREATE INDEX idx_posts_body ON posts(body(100));
{% } %}
```


## Basic Usage

```typescript
import { processFile, processFiles } from './core/template'

// Process a single template
const result = await processFile('/project/sql/users/001_create.sql.tmpl', {
    projectRoot: '/project',
    config: activeConfig,
    secrets: { API_KEY: 'secret123' },
})

console.log(result.sql)        // Rendered SQL
console.log(result.isTemplate) // true
console.log(result.durationMs) // 12

// Process multiple files
const results = await processFiles(
    ['/project/sql/001.sql', '/project/sql/002.sql.tmpl'],
    { projectRoot: '/project' }
)
```


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `template:helpers` | `{ filepath, count }` | Helper file loaded |
| `template:load` | `{ filepath, format }` | Data file loaded |
| `template:render` | `{ filepath, durationMs }` | Template rendered |
| `error` | `{ source: 'template', error, context }` | Render/load failure |

```typescript
import { observer } from './core/observer'

observer.on('template:render', ({ filepath, durationMs }) => {

    console.log(`Rendered ${filepath} in ${durationMs}ms`)
})

observer.on('template:load', ({ filepath, format }) => {

    console.log(`Loaded ${format} file: ${filepath}`)
})
```


## Additional Utilities

The template module exports several utility functions:

```typescript
import {
    findHelperFiles,        // Locate helper files up the directory tree
    toContextKey,           // Convert filenames to camelCase context keys
    sqlEscape,              // SQL escape a string (doubles single quotes)
    generateUuid,           // Generate UUID v4
    isoNow,                 // Get current ISO timestamp
    getSupportedExtensions, // Get all supported data file extensions
    getLoader,              // Get loader for a specific extension
    renderTemplate,         // Render a template directly
} from './core/template'

// Find helper files in directory tree
const helpers = await findHelperFiles('/project/sql/users')
// ['/project/sql/$helpers.ts', '/project/sql/users/$helpers.ts']

// Convert filename to context key
toContextKey('my-config.json5')  // 'myConfig'
toContextKey('seed_data.yml')    // 'seedData'

// SQL escape a value
sqlEscape("O'Reilly")  // "O''Reilly"

// Get supported extensions
getSupportedExtensions()
// ['.json', '.json5', '.yaml', '.yml', '.csv', '.js', '.mjs', '.ts', '.sql', '.dt', '.dtz']
// `.sql` has a loader (used by $.include) but is skipped during data auto-load.

// Get loader for extension
const loader = getLoader('.json5')
```


## Security Considerations

1. **SQL Injection** - Always use `$.quote()` or `$.escape()` for dynamic values from untrusted sources

2. **Secret Exposure** - Secrets are available in templates. The rendered SQL may contain sensitive values - don't log it

3. **JS Execution** - `$helpers.ts` files always execute; `.js` / `.mjs` / `.ts` data files execute only when the template references their context key. Both run arbitrary code in the noorm process — with access to the environment, including the identity key. Only load trusted files

4. **Path Traversal** - `$.include()` resolves relative to the template's directory and cannot escape the project root

# SQL Templates


Static SQL works for simple schemas. But real projects need dynamic SQL:

- Generating DDL for multiple similar tables
- Seeding data from external files
- Environment-aware SQL based on active configuration
- Injecting secrets without hardcoding

You could write custom scripts for each case. But then you're maintaining two systems—your SQL files and your generation scripts.

noorm solves this with **templates**. Any file ending in `.sql.tmpl` is processed before execution. Templates look like SQL with embedded logic. They auto-load data files, inherit helpers, and have access to secrets and config.


## Basic Syntax

Templates use [Eta](https://eta.js.org/) with custom delimiters designed to avoid conflicts with SQL syntax:

| Syntax | Purpose | Example |
|--------|---------|---------|
| `{% %}` | JavaScript code block | `{% for (const x of $.items) { %}` |
| `{%~ %}` | Output a value | `{%~ user.name %}` |
| `$` | Context variable | `$.config`, `$.secrets`, `$.uuid()` |

Here's a simple example:

```sql
-- seed_roles.sql.tmpl
{% for (const role of $.roles) { %}
INSERT INTO roles (name) VALUES ('{%~ role %}');
{% } %}
```

When rendered with `$.roles = ['admin', 'editor', 'viewer']`, this produces:

```sql
INSERT INTO roles (name) VALUES ('admin');
INSERT INTO roles (name) VALUES ('editor');
INSERT INTO roles (name) VALUES ('viewer');
```


## How Rendering Works

When noorm encounters a `.sql.tmpl` file:

1. Scans the template's directory for data files (JSON, YAML, CSV)
2. Walks up the directory tree collecting `$helpers.ts` files
3. Builds a context object (`$`) with helpers, data, config, and secrets
4. Renders the template with Eta
5. Returns the SQL string for execution


## The Template Context ($)

Everything available in your template lives on the `$` object:

| Property | Description |
|----------|-------------|
| `$.<datafile>` | Auto-loaded data from files in the same directory |
| `$.<helper>` | Functions from `$helpers.ts` files |
| `$.config` | Active database configuration |
| `$.secrets` | Decrypted secrets for active config |
| `$.globalSecrets` | Decrypted global secrets |
| `$.env` | Environment variables |


## Built-in Helpers

These helpers are always available in every template:

### $.quote(value)

Escapes a value and wraps it in single quotes. Use this for string values:

```sql
INSERT INTO users (name) VALUES ({%~ $.quote(user.name) %});
-- Input: O'Reilly
-- Output: INSERT INTO users (name) VALUES ('O''Reilly');
```

### $.escape(value)

Escapes a string by doubling single quotes, without adding surrounding quotes:

```sql
UPDATE users SET bio = '{%~ $.escape(user.bio) %}' WHERE id = 1;
-- Input: It's great
-- Output: UPDATE users SET bio = 'It''s great' WHERE id = 1;
```

### $.uuid()

Generates a UUID v4:

```sql
INSERT INTO tokens (id) VALUES ('{%~ $.uuid() %}');
-- Output: INSERT INTO tokens (id) VALUES ('550e8400-e29b-41d4-a716-446655440000');
```

### $.now()

Returns the current ISO timestamp:

```sql
INSERT INTO logs (created_at) VALUES ('{%~ $.now() %}');
-- Output: INSERT INTO logs (created_at) VALUES ('2024-01-15T10:30:00.000Z');
```

### $.json(value)

JSON stringifies a value:

```sql
INSERT INTO config (data) VALUES ('{%~ $.escape($.json(settings)) %}');
```

### $.include(path)

Includes another SQL file. The path is relative to the current template:

```sql
-- changes/2025-01-15-setup/change/001_setup.sql.tmpl

-- Load shared functions
{%~ await $.include('../lib/uuid_function.sql') %}

-- Load triggers
{%~ await $.include('../lib/audit_triggers.sql') %}
```


## Auto-Loading Data Files

Data files in the same directory as the template are automatically loaded into `$`:

```
sql/users/
├── 001_seed.sql.tmpl     # Template
├── users.json            # -> $.users
├── roles.yml             # -> $.roles
└── seed-data.csv         # -> $.seedData
```

File names are converted to camelCase:

| Filename | Context Key |
|----------|-------------|
| `my-config.json` | `$.myConfig` |
| `seed_data.yml` | `$.seedData` |
| `API_KEYS.json` | `$.apiKeys` |


### Naming Collisions

Different naming patterns can produce the same context key:

| Filename | Context Key |
|----------|-------------|
| `asc_fasb_org.json` | `$.ascFasbOrg` |
| `asc.fasb.org.yaml` | `$.ascFasbOrg` |
| `asc-fasb-org.csv` | `$.ascFasbOrg` |

If two files resolve to the same key, one silently overwrites the other. Use distinct base names to avoid conflicts.


### Supported Formats

| Extension | Notes |
|-----------|-------|
| `.json`, `.json5` | JSON5 supports comments and trailing commas |
| `.yaml`, `.yml` | Full YAML support |
| `.csv` | Parsed into array of row objects |
| `.dt`, `.dtz` | Exported database tables (see [Data Transfer](/guide/database/transfer)) |
| `.js`, `.mjs`, `.ts` | Module's default export or exports object (`.ts` requires Node >= 22.13) |


### JSON5 Example

JSON5 is easier to write by hand than strict JSON:

```json5
// users.json5 - Comments are allowed
{
    users: [
        { name: 'Alice', role: 'admin' },
        { name: 'Bob', role: 'user' },  // Trailing commas are fine
    ]
}
```

### CSV Example

Given `users.csv`:

```csv
email,name,role
alice@example.com,Alice,admin
bob@example.com,Bob,user
```

Access in your template as an array of objects:

```sql
-- seed.sql.tmpl
{% for (const user of $.users) { %}
INSERT INTO users (email, name, role) VALUES
    ({%~ $.quote(user.email) %}, {%~ $.quote(user.name) %}, {%~ $.quote(user.role) %});
{% } %}
```


### .dt Files (Exported Database Tables)

`.dt` and `.dtz` files exported from [Data Transfer](/guide/database/transfer) can be used directly as seed data. The loader reads the embedded schema, maps positional values to column names, and exposes the data as an array of row objects—just like CSV.

```
sql/users/
├── 001_seed.sql.tmpl     # Template
└── users.dt              # -> $.users (exported from another database)
```

```sql
-- seed.sql.tmpl
{% for (const user of $.users) { %}
INSERT INTO users (id, email, name) VALUES
    ({%~ user.id %}, {%~ $.quote(user.email) %}, {%~ $.quote(user.name) %});
{% } %}
```

This lets you export data from one environment and use it as seed data in templates—without converting formats. Compressed `.dtz` files work too. Encrypted `.dtzx` files are not supported as template data since there's no way to provide a passphrase in the template context.


## Helper Inheritance

Helper files named `$helpers.ts` (or `$helpers.js`) are automatically loaded and inherited up the directory tree:

```
sql/
├── $helpers.ts                  # Project-wide helpers
├── users/
│   ├── $helpers.ts              # Overrides/extends parent
│   ├── 001_create.sql.tmpl      # Has access to both
│   └── roles.json
└── products/
    └── 001_create.sql.tmpl      # Only has project-wide helpers
```

Child helpers override parent helpers with the same name. This lets you define project-wide utilities at the root and specialize them in subdirectories.


### Writing Helpers

Helper files can be written in TypeScript (`.ts`) or JavaScript (`.js`, `.mjs`). TypeScript helpers require Node >= 22.13, which supports type stripping natively. On older Node versions, use `.js` instead.

```typescript
// sql/$helpers.ts
export function padId(id: number, length = 6): string {

    return String(id).padStart(length, '0')
}

export function formatDate(date: Date): string {

    return date.toISOString().split('T')[0]
}

export const defaults = {
    pageSize: 50,
    maxRetries: 3,
}
```

Use in templates:

```sql
INSERT INTO users (id, created_at) VALUES
    ('{%~ $.padId(1) %}', '{%~ $.formatDate(new Date()) %}');

-- Output: INSERT INTO users (id, created_at) VALUES ('000001', '2024-01-15');
```


## Common Patterns


### Seeding from Data Files

```yaml
# roles.yml
- name: admin
  permissions: ["read", "write", "delete"]
- name: editor
  permissions: ["read", "write"]
- name: viewer
  permissions: ["read"]
```

```sql
-- seed_roles.sql.tmpl
{% for (const role of $.roles) { %}
INSERT INTO roles (name, permissions) VALUES
    ({%~ $.quote(role.name) %}, {%~ $.quote($.json(role.permissions)) %});
{% } %}
```


### Environment-Aware SQL

The active configuration is available through `$.config`. Use it to adapt SQL based on environment:

```sql
-- setup_monitoring.sql.tmpl
{% const db = $.config.connection.database %}

-- Tag all entries with the source database
INSERT INTO monitoring.activity_log (source_db, event, created_at) VALUES
    ({%~ $.quote(db) %}, 'schema_deployed', '{%~ $.now() %}');

{% if ($.config.name === 'production') { %}
-- Only production gets strict constraints
ALTER TABLE orders ADD CONSTRAINT chk_amount CHECK (amount > 0);
{% } %}
```


### Using Secrets

Never hardcode credentials. Access them through `$.secrets`:

```sql
-- config_setup.sql.tmpl
INSERT INTO app_config (key, value) VALUES
    ('stripe_key', {%~ $.quote($.secrets.STRIPE_KEY) %}),
    ('api_endpoint', {%~ $.quote($.env.API_URL || 'https://api.example.com') %});
```

Secrets resolve through a three-tier hierarchy: config-specific local secrets override global local secrets, which override team-shared [vault](/guide/environments/vault) secrets. This means you can store production credentials in the vault and override them locally for development without affecting teammates. See the [secret resolution hierarchy](/guide/environments/vault#secret-resolution-hierarchy) for details.


### Generating Multiple Similar Objects

When you have many similar tables, views, or procedures:

```yaml
# audit_tables.yml
tables:
    - users
    - posts
    - comments
    - orders
```

```sql
-- create_audit_triggers.sql.tmpl
{% for (const table of $.auditTables.tables) { %}
CREATE TRIGGER trg_{%~ table %}_audit
AFTER INSERT OR UPDATE OR DELETE ON {%~ table %}
FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

{% } %}
```


### Role-Based Permissions

Define permissions in YAML and generate all the grants:

```yaml
# permissions.yml
roles:
    WebApp:
        views: [Users_V, Posts_V, Settings_V]
        procs: [Login_trx, Signup_trx]
    Worker:
        views: [Queue_V, Jobs_V]
        procs: [ProcessJob_trx]
```

```sql
-- grant_permissions.sql.tmpl
{% for (const [role, perms] of Object.entries($.permissions.roles)) { %}
-- Grants for {%~ role %}
{% for (const view of perms.views || []) { %}
GRANT SELECT ON {%~ view %} TO {%~ role %};
{% } %}
{% for (const proc of perms.procs || []) { %}
GRANT EXECUTE ON {%~ proc %} TO {%~ role %};
{% } %}

{% } %}
```


### Composing from Fragments

Large table schemas are easier to review when split into logical groups. Use `$.include()` to compose them into a single change:

```
changes/2025-01-15-full-setup/
├── change/
│   └── 001_schema.sql.tmpl
└── lib/
    ├── core_tables.sql
    ├── content_tables.sql
    └── seed_defaults.sql
```

```sql
-- changes/2025-01-15-full-setup/change/001_schema.sql.tmpl

-- Core tables (users, roles, user_roles)
{%~ await $.include('../lib/core_tables.sql') %}

-- Content tables (posts, comments, tags, post_tags)
{%~ await $.include('../lib/content_tables.sql') %}

-- Default seed data
{%~ await $.include('../lib/seed_defaults.sql') %}
```

Each fragment is plain SQL that could run on its own. The template just stitches them together so the change stays atomic while the source stays organized.


## Security Notes

**SQL Injection**: Always use `$.quote()` or `$.escape()` for values from data files. Even trusted data files can contain characters that break SQL syntax.

**Secret Exposure**: The rendered SQL may contain sensitive values from `$.secrets`. Don't log rendered templates in production.

**Code Execution**: `$helpers.ts` files and `.js` data files execute arbitrary code. Only use trusted sources.

**Path Traversal**: `$.include()` resolves relative paths and cannot escape the project root.


## What's Next?

- [Organization](/guide/sql-files/organization) - Control execution order with file naming
- [Secrets](/guide/environments/secrets) - Securely store credentials
- [Vault](/guide/environments/vault) - Team-shared secrets with resolution hierarchy
- [Changes](/guide/changes/overview) - Versioned changes with template support
- [Data Transfer](/guide/database/transfer) - Export/import .dt files for seeding templates

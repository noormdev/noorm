# NoORM Templates Reference

Writing `.sql.tmpl` files — syntax, context API, secrets, environment variables, data files, and helpers.

## Table of Contents

1. [Syntax](#syntax)
2. [The Template Context ($)](#the-template-context-)
3. [Secrets and Environment Variables](#secrets-and-environment-variables)
4. [Built-in Helpers](#built-in-helpers)
5. [Auto-Loading Data Files](#auto-loading-data-files)
6. [Custom Helpers ($helpers.ts)](#custom-helpers-helpersts)
7. [Common Patterns](#common-patterns)
8. [Security](#security)

---

## Syntax

Templates use [Eta](https://eta.js.org/) with SQL-friendly delimiters:

| Syntax | Purpose | Example |
|---|---|---|
| `{% %}` | JavaScript code block | `{% for (const x of $.items) { %}` |
| `{%~ %}` | Output a value (interpolate) | `{%~ user.name %}` |
| `$` | Root context variable | `$.config`, `$.secrets`, `$.uuid()` |

### SQL-Comment Convention

Prefix directive-only lines with `-- ` (note the space after `--`) to keep `.sql.tmpl` files valid SQL in editors and linters. The renderer replaces the **entire line** (indentation, `-- ` prefix, trailing whitespace, and newline) with just the bare Eta tag — this suppresses blank lines in output:

```sql
-- {% for (const role of $.roles) { %}
INSERT INTO roles (name) VALUES ({%~ $.quote(role) %});
-- {% } %}
```

Only lines where the `-- ` prefix is followed exclusively by an Eta tag are processed this way. Lines mixing `-- ` with other content are left as-is (they're just SQL comments).

---

## The Template Context ($)

Everything available in a template lives on the `$` object:

| Property | Type | Description |
|---|---|---|
| `$.<datafile>` | varies | Auto-loaded data from files in the same directory |
| `$.<helper>` | function/value | Functions and values from `$helpers.ts` files |
| `$.config` | object | Active database configuration |
| `$.secrets` | `Record<string, string>` | Decrypted config-specific secrets |
| `$.globalSecrets` | `Record<string, string>` | Decrypted global (universal) secrets |
| `$.env` | `Record<string, string \| undefined>` | `process.env` — all environment variables |
| `$.quote()` | function | Built-in: SQL-escape + wrap in quotes |
| `$.escape()` | function | Built-in: SQL-escape without quotes |
| `$.uuid()` | function | Built-in: generate UUID v4 |
| `$.now()` | function | Built-in: ISO 8601 timestamp |
| `$.json()` | function | Built-in: JSON.stringify |
| `$.include()` | async function | Built-in: include another SQL file |

### $.config

The active database configuration object:

| Key | Example | Description |
|---|---|---|
| `$.config.name` | `'dev'` | Config name |
| `$.config.stage` | `'prod'` | Stage name |
| `$.config.isTest` | `true` | Whether config is marked as test |
| `$.config.connection.database` | `'myapp'` | Database name |
| `$.config.connection.host` | `'localhost'` | Database host |
| `$.config.connection.dialect` | `'postgres'` | Dialect |

**Note:** If a local data file named `config.json` (or `config.yml`, etc.) exists in the template directory, it overrides `$.config` entirely. Use a different filename for config-like data files.

---

## Secrets and Environment Variables

### Secrets ($.secrets, $.globalSecrets)

Access decrypted secrets directly by key:

```sql
-- config_setup.sql.tmpl
INSERT INTO app_config (key, value) VALUES
    ('stripe_key', {%~ $.quote($.secrets.STRIPE_KEY) %}),
    ('backup_key', {%~ $.quote($.globalSecrets.BACKUP_API_KEY) %});
```

**Resolution hierarchy** (highest wins):

1. **Config-specific local secrets** — set per-config via TUI or `noorm vault set KEY val`
2. **Global local secrets** — universal secrets in `settings.yml`
3. **Vault (team-shared)** — encrypted in database, shared across team

This means you can override production vault secrets locally for development without affecting teammates.

**Important:** `$.secrets` in templates is NOT the same as `ctx.noorm.secrets.get()` in SDK code. Templates get the fully-resolved secret records as a flat object. The SDK method is for programmatic access outside templates.

### Environment Variables ($.env)

All `process.env` variables are available:

```sql
-- setup.sql.tmpl
{% const apiUrl = $.env.API_URL || 'https://api.example.com' %}
{% const region = $.env.AWS_REGION || 'us-east-1' %}

INSERT INTO app_config (key, value) VALUES
    ('api_endpoint', {%~ $.quote(apiUrl) %}),
    ('deploy_region', {%~ $.quote(region) %});
```

Combine with config for environment-aware templates:

```sql
-- monitoring.sql.tmpl
{% if ($.config.stage === 'prod') { %}
-- Production: use real monitoring endpoint
INSERT INTO settings (key, value) VALUES
    ('monitor_url', {%~ $.quote($.env.MONITOR_URL) %});
{% } else { %}
-- Non-prod: use local endpoint
INSERT INTO settings (key, value) VALUES
    ('monitor_url', 'http://localhost:9090');
{% } %}
```

---

## Built-in Helpers

Always available in every template.

### $.quote(value)

SQL-escapes and wraps in single quotes. Handles `null` → `NULL`:

```sql
INSERT INTO users (name) VALUES ({%~ $.quote(user.name) %});
-- Input: O'Reilly  →  Output: 'O''Reilly'
-- Input: null      →  Output: NULL
```

### $.escape(value)

SQL-escapes (doubles single quotes) without adding surrounding quotes:

```sql
UPDATE users SET bio = '{%~ $.escape(user.bio) %}' WHERE id = 1;
-- Input: It's great  →  Output: It''s great
```

### $.uuid()

Generates a UUID v4:

```sql
INSERT INTO tokens (id) VALUES ('{%~ $.uuid() %}');
```

### $.now()

Returns current ISO 8601 timestamp:

```sql
INSERT INTO logs (created_at) VALUES ('{%~ $.now() %}');
-- Output: '2024-01-15T10:30:00.000Z'
```

### $.json(value)

JSON.stringify a value — useful for JSONB columns:

```sql
INSERT INTO config (data) VALUES ('{%~ $.escape($.json(settings)) %}');
```

### $.include(path)

Include another SQL file. Path is relative to the current template. **Async — must use `await`.**

If the included file is `.sql.tmpl`, it is recursively rendered with the same context.

```sql
-- changes/2025-01-15-setup/change/001_schema.sql.tmpl
{%~ await $.include('../lib/core_tables.sql') %}
{%~ await $.include('../lib/audit_triggers.sql.tmpl') %}
```

Path traversal outside the project root is blocked.

---

## Auto-Loading Data Files

Any supported file in the same directory as the template is automatically loaded onto `$`:

```
sql/users/
├── 001_seed.sql.tmpl     # Template
├── users.json            # → $.users
├── roles.yml             # → $.roles
└── seed-data.csv         # → $.seedData
```

### Filename → Context Key

Filenames are converted to camelCase:

| Filename | Context Key |
|---|---|
| `my-config.json` | `$.myConfig` |
| `seed_data.yml` | `$.seedData` |
| `API_KEYS.json` | `$.apiKeys` |

**Collision warning:** `user_roles.json` and `user-roles.yaml` both resolve to `$.userRoles`. One silently overwrites the other.

### Supported Formats

| Extension | Loaded As |
|---|---|
| `.json`, `.json5` | Object/array (JSON5 supports comments, trailing commas) |
| `.yaml`, `.yml` | Object/array |
| `.csv` | Array of row objects (headers become keys) |
| `.dt`, `.dtz` | Array of row objects (exported database tables) |
| `.js`, `.mjs`, `.ts` | Module's default export or exports object |

`.dtzx` (encrypted) files are NOT supported as data files — no way to provide passphrase in template context.

---

## Custom Helpers ($helpers.ts)

Files named `$helpers.ts` (or `.js`, `.mjs`) are auto-discovered by walking UP the directory tree to the project root. Child helpers override parent helpers with the same name.

```
sql/
├── $helpers.ts                  # Project-wide helpers
├── users/
│   ├── $helpers.ts              # Overrides parent for this subtree
│   └── 001_seed.sql.tmpl        # Has both helper sets
└── products/
    └── 001_create.sql.tmpl      # Only has project-wide helpers
```

### Writing Helpers

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
-- Output: ('000001', '2024-01-15')
```

TypeScript helpers require Node >= 22.13 (native type stripping). Use `.js` on older versions.

---

## Common Patterns

### Seeding from YAML/JSON

```yaml
# roles.yml
- name: admin
  permissions: ["read", "write", "delete"]
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

```sql
-- setup.sql.tmpl
{% if ($.config.stage === 'prod') { %}
ALTER TABLE orders ADD CONSTRAINT chk_amount CHECK (amount > 0);
{% } %}

{% if ($.config.isTest) { %}
INSERT INTO users (name, email) VALUES ('Test User', 'test@example.com');
{% } %}
```

### Injecting Secrets into Config Tables

```sql
-- app_secrets.sql.tmpl
INSERT INTO app_config (key, value) VALUES
    ('stripe_key', {%~ $.quote($.secrets.STRIPE_KEY) %}),
    ('api_url', {%~ $.quote($.env.API_URL || 'https://api.example.com') %});
```

### Generating Grants from Data

```yaml
# permissions.yml
roles:
    WebApp:
        views: [Users_V, Posts_V]
        procs: [Login_trx, Signup_trx]
    Worker:
        views: [Queue_V]
        procs: [ProcessJob_trx]
```

```sql
-- grant_permissions.sql.tmpl
{% for (const [role, perms] of Object.entries($.permissions.roles)) { %}
{% for (const view of perms.views || []) { %}
GRANT SELECT ON {%~ view %} TO {%~ role %};
{% } %}
{% for (const proc of perms.procs || []) { %}
GRANT EXECUTE ON {%~ proc %} TO {%~ role %};
{% } %}
{% } %}
```

### Composing from Fragments

```sql
-- changes/2025-01-15-setup/change/001_schema.sql.tmpl
{%~ await $.include('../lib/core_tables.sql') %}
{%~ await $.include('../lib/content_tables.sql') %}
{%~ await $.include('../lib/seed_defaults.sql') %}
```

---

## Security

| Concern | Guidance |
|---|---|
| **SQL injection** | Always use `$.quote()` or `$.escape()` for data file values — even trusted data can contain quote characters |
| **Secret exposure** | Rendered SQL contains plaintext secrets. Never log rendered templates in production |
| **Code execution** | `$helpers.ts` and `.js` data files execute arbitrary code. Only use trusted sources |
| **Path traversal** | `$.include()` cannot escape the project root |

---

## Previewing and Inspecting

Before executing, preview or inspect templates:

**CLI:**

```bash
noorm run preview sql/schema.sql.tmpl              # Rendered SQL to stdout
noorm run preview sql/schema.sql.tmpl > rendered.sql
noorm run inspect sql/seed.sql.tmpl                 # Show available context
```

**SDK:**

```typescript
const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl');
// result: { name, content, error?, durationMs? }
```

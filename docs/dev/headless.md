# CLI Architecture


## Overview

Every `noorm` command runs as a non-interactive CLI. Use it for:

- **CI/CD pipelines** — automated deployments with GitHub Actions, GitLab CI, Jenkins
- **Scripts** — batch operations and tooling
- **Automation** — scheduled jobs and cron tasks
- **Ephemeral environments** — no stored state needed with env-only mode

The interactive Ink/React TUI lives behind a dedicated subcommand — `noorm ui` — and is fully decoupled from the headless CLI. There is no `--headless`/`--tui` flag and no mode detection: every other command streams structured output straight to stdout and exits with a conventional code.

Internally, the CLI is built on [citty](https://github.com/unjs/citty). Each command is a `defineCommand({ meta, args, run })` module under `src/cli/<domain>/`; the root entry point (`src/cli/index.ts`) composes them into a tree of subcommands and intercepts `--help` to append per-command `EXAMPLES` blocks.


## Common Flags

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--json` | — | boolean | false | Emit machine-readable JSON instead of human text |
| `--config` | `-c` | string | — | Config name to use (defaults to the active config) |
| `--force` | `-f` | boolean | false | Force operation (skip checksums) |
| `--yes` | `-y` | boolean | false | Skip confirmations |
| `--dry-run` | — | boolean | false | Preview without executing |
| `--help` | `-h` | boolean | false | Show citty-rendered help and exit |

Not every command accepts every flag — append `--help` to any command to see the exact surface.

**Example:**
```bash
noorm --json --config prod change ff
noorm change ff --help       # Per-command help, rendered by citty
```


## Configuration


### Config Resolution

noorm resolves which config to use in this order:

1. `--config` CLI flag
2. `NOORM_CONFIG` env var
3. Active config from state (set via `noorm config use <name>`)

If you've already set an active config (via `noorm config use <name>` or through `noorm ui`), every subsequent command picks it up automatically:

```bash
# These are equivalent if 'dev' is the active config
noorm change ff
noorm --config dev change ff
```


### Using Stored Configs

Specify a config by name using `--config` or the `NOORM_CONFIG` env var:

```bash
# Via flag
noorm --config production change ff

# Via env var
export NOORM_CONFIG=production
noorm change ff
```


### ENV Variable Overrides

Override any config property via `NOORM_*` environment variables:

```bash
# Override connection host for CI runner
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONFIG=staging

noorm change ff  # Uses staging config with overridden host
```

**Priority** (highest to lowest):
1. `NOORM_*` env vars
2. Stored config
3. Stage defaults
4. Defaults


### Env-Only Mode (No Stored Config)

In ephemeral CI environments without stored configs, run with only ENV vars:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONNECTION_DATABASE=myapp_ci
export NOORM_CONNECTION_USER=ci_user
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD

noorm run build  # No --config needed
```

**Minimum required for env-only mode:**
- `NOORM_CONNECTION_DIALECT` (postgres, mysql, sqlite, mssql)
- `NOORM_CONNECTION_DATABASE`

See [Configuration](./config.md) for the full list of supported environment variables.


## Available Commands


### Schema Operations

#### `run build`

Execute all SQL files in the schema directory.

```bash
noorm run build
noorm --force run build  # Skip checksums
```

**JSON output:**
```json
{
    "status": "success",
    "filesRun": 5,
    "filesSkipped": 2,
    "filesFailed": 0,
    "durationMs": 1234
}
```

#### `run file`

Execute a single SQL file.

```bash
noorm run file sql/01_tables/001_users.sql
noorm --path sql/01_tables/001_users.sql run file
```

**JSON output:**
```json
{
    "filepath": "sql/01_tables/001_users.sql",
    "status": "success",
    "durationMs": 45
}
```

#### `run dir`

Execute all SQL files in a directory.

```bash
noorm run dir sql/01_tables/
```


### Change Operations

#### `change` (or `change list`)

List change status.

```bash
noorm change
```

**JSON output:**
```json
[
    { "name": "001_init", "status": "applied", "direction": "forward" },
    { "name": "002_users", "status": "pending", "direction": "forward" }
]
```

#### `change ff`

Fast-forward: apply all pending changes.

```bash
noorm change ff
```

**JSON output:**
```json
{
    "status": "success",
    "executed": 3,
    "skipped": 0,
    "failed": 0,
    "changes": [
        { "name": "001_init", "status": "success", "durationMs": 45 },
        { "name": "002_users", "status": "success", "durationMs": 123 }
    ]
}
```

#### `change run`

Apply a specific change.

```bash
noorm change run 001_init
noorm --name 001_init change run
```

#### `change revert`

Revert a specific change.

```bash
noorm change revert 001_init
```

#### `change history`

Get execution history.

```bash
noorm change history
noorm --count 50 change history  # Last 50 records
```


### Database Operations

#### `db truncate`

Wipe all data, keeping the schema intact.

```bash
noorm db truncate
```

**JSON output:**
```json
{
    "truncated": ["users", "posts", "comments"],
    "count": 3
}
```

#### `db teardown`

Drop all database objects (except noorm tracking tables).

```bash
noorm db teardown
```

**JSON output:**
```json
{
    "dropped": {
        "tables": 5,
        "views": 2,
        "functions": 3,
        "types": 1
    },
    "count": 11
}
```


### Database Exploration

#### `db explore`

Get database overview with object counts.

```bash
noorm db explore
```

**JSON output:**
```json
{
    "tables": 12,
    "views": 3,
    "functions": 5,
    "procedures": 0,
    "types": 2
}
```

#### `db explore tables`

List all tables.

```bash
noorm db explore tables
```

**JSON output:**
```json
[
    { "name": "users", "columnCount": 8 },
    { "name": "posts", "columnCount": 5 }
]
```

#### `db explore tables detail`

Describe a specific table.

```bash
noorm --name users db explore tables detail
```

**JSON output:**
```json
{
    "name": "users",
    "schema": "public",
    "columns": [
        { "name": "id", "dataType": "integer", "nullable": false, "isPrimaryKey": true },
        { "name": "email", "dataType": "varchar(255)", "nullable": false }
    ]
}
```


### Lock Operations

#### `lock status`

Check current lock status.

```bash
noorm lock status
```

**JSON output:**
```json
{
    "isLocked": true,
    "lock": {
        "lockedBy": "deploy@ci-runner",
        "lockedAt": "2024-01-15T10:30:00Z",
        "expiresAt": "2024-01-15T10:35:00Z"
    }
}
```

#### `lock acquire`

Acquire a database lock.

```bash
noorm lock acquire
```

#### `lock release`

Release the current lock.

```bash
noorm lock release
```


## Output Formats


### Text Output (Default)

Colored console output with status icons:

```
✓ Fast-forward success
  ✓ 001_init 45ms
  ✓ 002_users 123ms
  ✓ 003_posts 89ms
  Executed: 3, Skipped: 0, Failed: 0
```


### JSON Output

Use `--json` for machine-readable output:

```bash
noorm --json change ff | jq '.executed'
```

JSON mode disables colors and outputs structured data.


### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Failure |

Always check the exit code in scripts:

```bash
noorm change ff || exit 1
```


## CI/CD Examples


### GitHub Actions

```yaml
name: Database Changes

on:
    push:
        branches: [main]

jobs:
    migrate:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
            - run: npm ci

            - name: Apply changes
              env:
                  NOORM_CONFIG: production
                  NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
                  NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
              run: noorm change ff

            - name: Export schema (optional)
              run: noorm --json -c prod db explore > schema.json
```


### GitHub Actions (Env-Only Mode)

For ephemeral environments without stored configs:

```yaml
- name: Apply changes
  env:
      NOORM_CONNECTION_DIALECT: postgres
      NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
      NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
      NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
      NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: noorm change ff
```


### GitLab CI

```yaml
migrate:
    stage: deploy
    script:
        - npm ci
        - noorm --config production change ff
    only:
        - main
    environment:
        name: production
```


### Shell Script

```bash
#!/bin/bash
set -e

CONFIG="${1:-}"  # Optional, falls back to active config

echo "Checking for pending changes..."
PENDING=$(noorm --json ${CONFIG:+-c "$CONFIG"} change | jq '[.[] | select(.status=="pending")] | length')

if [ "$PENDING" -gt 0 ]; then
    echo "Applying $PENDING pending changes..."
    noorm ${CONFIG:+-c "$CONFIG"} change ff
else
    echo "Database is up to date"
fi
```


### With Lock Protection

For concurrent deployments, use locks:

```bash
#!/bin/bash
set -e

# Acquire lock (fails if already locked)
noorm lock acquire

# Ensure lock is released on exit
trap "noorm lock release" EXIT

# Safe to apply changes
noorm change ff
```


## Best Practices

1. **Be explicit in CI** - Use `--config` or `NOORM_CONFIG` in CI pipelines for clarity

2. **Use `--json` for scripting** - Easier to parse than text output
   ```bash
   noorm --json change | jq '.[] | select(.status=="pending")'
   ```

3. **Check exit codes** - Non-zero means failure
   ```bash
   noorm change ff || { echo "Change failed"; exit 1; }
   ```

4. **Use locks for concurrent operations** - Prevent race conditions in parallel deployments

5. **Use env vars for credentials** - Never hardcode secrets
   ```bash
   export NOORM_CONNECTION_PASSWORD="$DB_PASSWORD"
   ```

6. **Test with `--dry-run`** - Preview operations before executing
   ```bash
   noorm --dry-run change ff
   ```

7. **Capture logs** - noorm appends to `.noorm/state/noorm.log` for debugging


## Error Messages

Common errors and their meanings:

| Error | Cause | Solution |
|-------|-------|----------|
| `No config available` | No config, env var, or active config | Set `--config`, `NOORM_CONFIG`, or run `noorm config use <name>` |
| `Config 'x' not found` | Named config doesn't exist | Check config name or use env-only mode |
| `Connection refused` | Database unreachable | Verify host, port, and network access |
| `Lock held by x` | Another process has the lock | Wait or investigate the lock holder |
| `Change 'x' not found` | Named change doesn't exist | Check change name |


## Command Syntax

Commands use space-separated subcommands:

```bash
noorm change ff
noorm db explore tables detail users

# Positional arguments come last; flags can appear anywhere after
# the leaf command (citty parses options per-subcommand).
noorm change ff --dry-run
noorm vault cp --all staging production
noorm db transfer --to backup --tables users,posts
```

There is no colon or slash syntax — the old `change:ff` / `change/ff` notation was a meow-era artifact and is gone.


## Adding New Commands

Each command is a self-contained citty `defineCommand` module. Domains map to directories, leaves map to files, and the root `index.ts` registers them as `subCommands`.


### File Structure

```
src/cli/
├── _utils.ts             # withContext, withVaultContext, sharedArgs, output helpers
├── index.ts              # Root command + --help interceptor
├── ui.ts                 # Lazy-imports the TUI
├── change/
│   ├── index.ts          # `noorm change` parent (subCommands + run handler)
│   ├── ff.ts             # `noorm change ff`
│   ├── run.ts            # `noorm change run`
│   └── ...
├── config/
├── db/
├── lock/
├── run/
├── vault/
└── mcp/
```


### Command Module Pattern

Each leaf command exports a citty `defineCommand` and (optionally) an `examples: string[]` array used by the `--help` interceptor:

```typescript
// src/cli/change/ff.ts
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { sharedArgs, withContext, outputResult } from '../_utils.js';

const command = defineCommand({
    meta: {
        name: 'ff',
        description: 'Fast-forward: apply all pending changes',
    },
    args: {
        ...sharedArgs,                           // config, json, force, dryRun, yes
        // Add per-command args here:
        // limit: { type: 'string', description: 'Stop after N changes' },
    },
    async run({ args }) {

        const [result, err] = await withContext({
            args,
            fn: async (ctx, logger) => {

                if (!args.json) logger.info('Applying pending changes...');

                return ctx.noorm.changes.ff({ dryRun: args.dryRun });

            },
        });

        if (err) process.exit(1);

        outputResult(args, result, `Applied ${result.applied} changes`);

    },
});

// Examples consumed by the --help interceptor in src/cli/index.ts
(command as { examples?: string[] }).examples = [
    'noorm change ff',
    'noorm change ff --dry-run',
    'noorm change ff --json',
];

export default command;
```

Key details:

- **`sharedArgs`** lives in `src/cli/_utils.ts` and supplies the conventional `--config`, `--json`, `--force`, `--dry-run`, `--yes` set. Spread it first, then add your own.
- **`withContext`** owns the SDK lifecycle (`createContext` → `connect` → `ensureSchemaVersion` → run → `disconnect`) and returns an `[result, error]` tuple. It also creates a logger configured for JSON or text output.
- **Logger guards** — when `args.json` is true, only structured JSON should reach stdout. Wrap any human progress output in `if (!args.json) { ... }` so callers piping JSON downstream get clean output.
- **`outputResult`** routes its first arg to `logger.result(json)` in `--json` mode and to `logger.info(text)` in human mode.
- **`examples`** is post-assigned via a typed cast because citty's `CommandDef` type does not include the field. The root `--help` interceptor reads it and renders an `EXAMPLES` block.


### Parent Commands

Domain parents (e.g., `noorm change`) live at `src/cli/<domain>/index.ts`. They register their leaves under `subCommands` and may optionally provide a `run` handler that executes when called bare (e.g., `noorm change` shows status):

```typescript
// src/cli/change/index.ts
import { defineCommand } from 'citty';

import ff from './ff.js';
import history from './history.js';
import revert from './revert.js';
import run from './run.js';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

export default defineCommand({
    meta: {
        name: 'change',
        description: 'Manage schema changes',
    },
    args: { ...sharedArgs },
    subCommands: { ff, history, revert, run },
    async run({ args }) {

        // Bare `noorm change` — show status
        const [result, err] = await withContext({
            args,
            fn: (ctx) => ctx.noorm.changes.status(),
        });
        if (err) process.exit(1);
        outputResult(args, result, formatStatus(result));

    },
});
```


### TUI-Only Wizards

Some commands (`config add`, `config edit`, `config rm`) don't have a sensible headless equivalent — they exist to walk users through credential entry interactively. These commands `import { app } from '../../tui/app.js'` and route the user into the appropriate TUI screen, then exit. See `src/cli/config/add.ts` for the canonical pattern.


### Registering Commands at the Root

Add the new domain (or leaf) to `src/cli/index.ts`:

```typescript
// src/cli/index.ts
import change from './change/index.js';
import config from './config/index.js';
// ...new domain
import myDomain from './my-domain/index.js';

const main = defineCommand({
    meta: { name: 'noorm', description: '...' },
    subCommands: {
        change,
        config,
        // ...
        'my-domain': myDomain,
    },
});
```

Citty handles routing automatically — there is no central `HANDLERS` registry or route string to maintain.


### Testing Commands

Test commands end-to-end through the built CLI binary using `tests/integration/cli/setup.ts`:

```typescript
import { setupTestProject, cleanupTestProject, noorm, noormJson } from './setup.js';

describe('cli: change ff', () => {

    let project;

    beforeAll(async () => { project = await setupTestProject(); });
    afterAll(async () => { await cleanupTestProject(project); });

    it('applies pending changes', async () => {

        const result = await noorm(project, 'change', 'ff');
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Applied');

    });

    it('emits structured JSON with --json', async () => {

        const result = await noormJson<{ applied: number }>(project, 'change', 'ff');
        expect(result.ok).toBe(true);
        expect(result.data?.applied).toBeGreaterThanOrEqual(0);

    });

});
```

The setup helper builds an isolated SQLite project and runs the compiled CLI via `node packages/cli/dist/index.js`. `noormJson` automatically appends `--json` after the command path (citty parses flags per-subcommand, so it must come last).

# noorm - Database Schema & Changeset Manager


## Philosophy

- You always keep an up-to-date schema of current state
- You run changesets to update your schemas — which are done with, but the history doesn't matter
- To get started, you just run a build and it should create your DB from scratch


## Tech Stack

- **Kysely** - SQL query builder & executor (handles all dialect differences internally)
- **Eta** - Templating engine for dynamic SQL
- **Ink + React** - CLI interface


## Dialect Philosophy

**noorm does NOT abstract SQL dialects.** You write SQL for your target database.

Kysely handles:
- Connection management
- Query execution
- Transactions
- Internal tracking tables (`__change_files__`, `__change_version__`, `__noorm_lock__`)

You handle:
- Writing SQL in your dialect of choice
- Dialect-specific syntax in your schema/changeset files

This means:
- No leaky abstractions
- Full power of your database
- No "lowest common denominator" SQL
- Works with any Kysely-compatible database (Postgres, MySQL, SQLite, SQL Server, etc.)

The only dialect-aware code is the connection factory that creates the appropriate Kysely instance from your config.


## Navigation Architecture

Hybrid approach: Full TUI app with command-line entry points.

### Entry Modes

```bash
$ noorm                       # Opens full TUI at home screen
$ noorm config                # Jumps directly to config list screen
$ noorm config add            # Jumps directly to config add screen
$ noorm -H config add --name=dev  # Non-interactive for CI/scripts
```

### Screen Graph

```
home
├── config
│   ├── config/add
│   ├── config/edit/:name
│   ├── config/rm/:name
│   ├── config/cp
│   └── config/use
├── change
│   ├── change/add
│   ├── change/edit/:name
│   ├── change/rm/:name
│   ├── change/run/:name
│   ├── change/revert/:name
│   ├── change/next
│   └── change/ff
├── run
│   ├── run/build
│   ├── run/file
│   └── run/dir
├── db
│   ├── db/create
│   └── db/destroy
└── lock
    ├── lock/status
    └── lock/release
```

### Home Screen Layout

```
┌─────────────────────────────────────────────────┐
│  noorm                                          │
│  ─────────────────────────────────────────────  │
│  [Config]  Change   Run   DB                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  Configs                                        │
│  ────────                                       │
│  > dev (active)                                 │
│    staging                                      │
│    production 🔒                                │
│                                                 │
│                                                 │
├─────────────────────────────────────────────────┤
│  [a]dd  [e]dit  [d]elete  [enter]use  [q]uit   │
└─────────────────────────────────────────────────┘
```

### Router Implementation

```typescript
type Route =
    | 'home'
    | 'config' | 'config/add' | 'config/edit' | 'config/rm' | 'config/cp' | 'config/use'
    | 'change' | 'change/add' | 'change/edit' | 'change/rm' | 'change/run' | 'change/revert' | 'change/next' | 'change/ff'
    | 'run' | 'run/build' | 'run/file' | 'run/dir'
    | 'db' | 'db/create' | 'db/destroy'
    | 'lock' | 'lock/status' | 'lock/release';

interface RouterContext {
    route: Route;
    params: Record<string, string>;  // e.g., { name: 'production' }
    navigate: (route: Route, params?: Record<string, string>) => void;
    back: () => void;
    history: Route[];
}

const App = ({ initialRoute }: { initialRoute?: Route }) => {
    const [route, setRoute] = useState<Route>(initialRoute ?? 'home');
    const [params, setParams] = useState<Record<string, string>>({});
    const [history, setHistory] = useState<Route[]>([]);

    const navigate = (newRoute: Route, newParams?: Record<string, string>) => {
        setHistory(prev => [...prev, route]);
        setRoute(newRoute);
        setParams(newParams ?? {});
    };

    const back = () => {
        const prev = history[history.length - 1];
        if (prev) {
            setHistory(h => h.slice(0, -1));
            setRoute(prev);
        }
    };

    return (
        <RouterContext.Provider value={{ route, params, navigate, back, history }}>
            <Screen />
        </RouterContext.Provider>
    );
};
```

### Screen Component Pattern

```typescript
const Screen = () => {
    const { route } = useRouter();

    const screens: Record<Route, React.FC> = {
        'home': HomeScreen,
        'config': ConfigListScreen,
        'config/add': ConfigAddScreen,
        'config/edit': ConfigEditScreen,
        // ...
    };

    const Component = screens[route] ?? HomeScreen;
    return <Component />;
};
```

### Keyboard Navigation

Global hotkeys available on all screens:

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Navigate between top-level sections |
| `Escape` / `Backspace` | Go back to previous screen |
| `q` | Quit application |
| `?` | Show help overlay |

Section-specific hotkeys shown in footer of each screen.

### Headless Mode

Triggered by:

1. `-H` flag (explicit)
2. `CI=1` or `CI=true` environment variable (automatic)

```bash
# Explicit headless
$ noorm -H run build

# Auto-detected in CI environments (GitHub Actions, GitLab CI, etc.)
$ CI=1 noorm run build
```

Headless mode behavior:

- No interactive UI
- All parameters via flags or environment variables
- JSON output option: `--json`
- Exit codes for success/failure
- `--yes` flag to skip confirmations (or `NOORM_YES=1`)


### Environment Variable Configuration

All config can be set via environment variables for CI/CD:

```bash
# Connection
NOORM_DIALECT=postgres
NOORM_HOST=localhost
NOORM_PORT=5432
NOORM_DATABASE=myapp
NOORM_USER=postgres
NOORM_PASSWORD=secret

# Paths
NOORM_SCHEMA_PATH=./schema
NOORM_CHANGESET_PATH=./changesets

# Behavior
NOORM_CONFIG=production          # Which config to use
NOORM_YES=1                      # Skip confirmations
NOORM_JSON=1                     # JSON output

# Identity override
NOORM_IDENTITY="CI Bot <ci@example.com>"
```

**Priority order (highest to lowest):**

1. CLI flags (`--database=myapp`)
2. Environment variables (`NOORM_DATABASE=myapp`)
3. Active config file (`.noorm/configs.enc`)
4. Defaults

### CI Example: GitHub Actions

```yaml
name: Database Migration

on: [push]

jobs:
  migrate:
    runs-on: ubuntu-latest
    env:
      NOORM_DIALECT: postgres
      NOORM_HOST: ${{ secrets.DB_HOST }}
      NOORM_DATABASE: ${{ secrets.DB_NAME }}
      NOORM_USER: ${{ secrets.DB_USER }}
      NOORM_PASSWORD: ${{ secrets.DB_PASSWORD }}
      NOORM_IDENTITY: "GitHub Actions"

    steps:
      - uses: actions/checkout@v4

      - name: Run schema build
        run: noorm run build

      - name: Apply pending changesets
        run: noorm change run --all
```

### CI Example: Docker Compose

```yaml
services:
  migrate:
    image: your-app
    environment:
      - NOORM_DIALECT=postgres
      - NOORM_HOST=db
      - NOORM_DATABASE=myapp
      - NOORM_USER=postgres
      - NOORM_PASSWORD=secret
      - CI=1
    command: noorm run build
    depends_on:
      - db
```


## Project Structure

```
schema/                    # Always reflects "what the DB should look like now"
├── 001_users.sql
├── 002_posts.sql
└── 003_comments.sql

changesets/                # Modifications after initial build
└── 2024-01-15_add-email-verification/
    ├── change/
    │   ├── 001_alter_users.sql
    │   └── 002_create_tokens.sql
    └── revert/
        ├── 001_drop_tokens.sql
        └── 002_revert_users.sql

.noorm/                    # Local encrypted config storage
└── configs.enc
```


## CLI Commands

### Config

Manage database configurations for different environments.

```
dbx config add          # Interactive config creation
dbx config edit <name>  # Edit existing config
dbx config rm <name>    # Remove config (confirm if protected)
dbx config list         # Show all configs
dbx config cp <from> <to>  # Clone a config
dbx config use <name>   # Set active config
```

**Config properties:**

- `name` - Identifier (dev, staging, prod, etc.)
- `type` - local | remote
- `isTest` - Boolean flag for test databases
- `protected` - Requires confirmation for state-modifying operations
- `connection` - Database connection details
- `paths` - Schema and changeset directories
- `secrets` - Encrypted per-config variables

**Protected config behavior:**

| Action | Behavior |
|--------|----------|
| change:run | Requires confirmation |
| change:revert | Requires confirmation |
| run:build | Requires confirmation |
| run:file | Requires confirmation |
| run:dir | Requires confirmation |
| db:create | Requires confirmation |
| db:destroy | **Blocked entirely** |
| config:rm | Requires confirmation |

Confirmation format: Type `yes-<config-name>` (e.g., `yes-production`)


### Change

Manage changesets that modify the database after initial build.

```
noorm change add [name]     # Create new changeset folder
noorm change edit <name>    # Open changeset in editor
noorm change rm <name>      # Remove changeset
noorm change list           # Show all changesets + status
noorm change run [name]     # Run specific changeset
noorm change revert <name>  # Revert a changeset
noorm change next [n]       # Apply next N pending changesets (default: 1)
noorm change ff             # Fast-forward: apply ALL pending changesets
```

**Changeset structure:**

- Dated folders with sorted-by-filename `.txt` and `.sql` files
- Two subfolders: `change/` and `revert/`
- `.txt` files contain lists of SQL files (relative paths) to run in sequence
- History tracked: what was run, when, by who, status


### Run

Execute SQL files and directories.

```
dbx run build           # Execute schema/ folder in order
dbx run file <path>     # Execute single SQL file
dbx run dir <path>      # Execute directory of SQL files
```

- Order is user-defined by filename
- All runs tracked in `__change_files__` table


### DB

Database lifecycle management.

```
noorm db create         # Create database from config
noorm db destroy        # Drop database (blocked if protected)
```


### Lock

Manage concurrent operation locks.

```
noorm lock status       # Check current lock state
noorm lock release      # Force release lock (confirm on protected configs)
```


## Tracking Tables

Initialized when config is first used.

### __change_files__

Tracks every SQL file execution.

```sql
CREATE TABLE __change_files__ (
    id SERIAL PRIMARY KEY,
    filepath VARCHAR(500) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    size_bytes INTEGER,
    executed_at TIMESTAMP DEFAULT NOW(),
    executed_by VARCHAR(255) NOT NULL,
    identity_source VARCHAR(20),          -- 'git', 'system', 'config'
    config_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,          -- 'success', 'failed'
    error_message TEXT,
    duration_ms INTEGER,
    UNIQUE(filepath, config_name)
);
```


### __change_version__

Tracks changeset executions.

```sql
CREATE TABLE __change_version__ (
    id SERIAL PRIMARY KEY,
    changeset_name VARCHAR(255) NOT NULL,
    direction VARCHAR(10) NOT NULL,       -- 'change', 'revert'
    executed_at TIMESTAMP DEFAULT NOW(),
    executed_by VARCHAR(255) NOT NULL,
    identity_source VARCHAR(20),
    config_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    files_executed JSONB,                 -- [{filepath, checksum, status}]
    duration_ms INTEGER,
    UNIQUE(changeset_name, config_name, direction)
);
```


### __secrets__

Encrypted secrets per config.

```sql
CREATE TABLE __secrets__ (
    id SERIAL PRIMARY KEY,
    config_name VARCHAR(100) NOT NULL,
    key VARCHAR(255) NOT NULL,
    value_encrypted TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(config_name, key)
);
```


## Identity Resolution

Determines "executed_by" for tracking.

Priority order:

1. **Config override** - Explicit identity set in config
2. **Git user** - `git config user.name` / `user.email`
3. **System user** - `os.userInfo().username`

```typescript
interface Identity {
    name: string;
    email?: string;
    source: 'git' | 'system' | 'config';
}
```


## File Tracking

Files are tracked by content hash (SHA-256).

On execution, check if file should run:

- **new** - File not in `__change_files__` → run
- **changed** - Checksum differs from last run → run
- **unchanged** - Same checksum → skip


## Module Architecture

```
src/
├── cli/
│   ├── commands/
│   │   ├── config/
│   │   │   ├── add.tsx
│   │   │   ├── edit.tsx
│   │   │   ├── rm.tsx
│   │   │   ├── list.tsx
│   │   │   ├── cp.tsx
│   │   │   └── use.tsx
│   │   ├── change/
│   │   │   ├── add.tsx
│   │   │   ├── edit.tsx
│   │   │   ├── rm.tsx
│   │   │   ├── list.tsx
│   │   │   ├── run.tsx
│   │   │   ├── revert.tsx
│   │   │   ├── next.tsx
│   │   │   └── ff.tsx
│   │   ├── run/
│   │   │   ├── build.tsx
│   │   │   ├── file.tsx
│   │   │   └── dir.tsx
│   │   ├── db/
│   │   │   ├── create.tsx
│   │   │   └── destroy.tsx
│   │   └── lock/
│   │       ├── status.tsx
│   │       └── release.tsx
│   ├── components/
│   │   ├── ProtectedActionPrompt.tsx
│   │   ├── BlockedActionMessage.tsx
│   │   └── ...
│   └── app.tsx
├── core/
│   ├── encryption/
│   │   ├── manager.ts          # High-level encrypt/decrypt API
│   │   ├── machine-id.ts       # Machine ID derivation
│   │   └── crypto.ts           # Low-level AES-256-GCM operations
│   ├── config/
│   │   ├── manager.ts
│   │   ├── secrets.ts
│   │   └── types.ts
│   ├── changeset/
│   │   ├── manager.ts
│   │   ├── parser.ts
│   │   ├── executor.ts
│   │   └── history.ts
│   ├── runner/
│   │   ├── build.ts
│   │   ├── file.ts
│   │   ├── dir.ts
│   │   └── tracker.ts
│   ├── db/
│   │   ├── lifecycle.ts
│   │   └── bootstrap.ts
│   ├── template/
│   │   └── eta.ts
│   ├── identity/
│   │   └── resolver.ts
│   └── executor/
│       └── kysely.ts
├── connection/
│   └── factory.ts          # Creates Kysely instance from config
└── env/
    └── loader.ts
```


## Config Storage

- Configs stored in `.noorm/` folder (local to project)
- Encrypted using machine ID
- Never committed to version control (add `.noorm/` to `.gitignore`)


## Encryption Manager

Handles encryption/decryption of config files and secrets. State lives in memory while the program runs, encrypted on disk.

### Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                         ON DISK                             │
│                   .noorm/state.enc                          │
│                    (encrypted)                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │         FIRST READ            │
          │   decrypt → load into memory  │
          └───────────────┬───────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       IN MEMORY                             │
│                     StateManager                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  configs[]  │  │  secrets{}  │  │  activeConfig       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │        ON EVERY WRITE         │
          │   encrypt → save to disk      │
          └───────────────────────────────┘
```

### State Manager

```typescript
interface State {
    version: 1;
    activeConfig: string | null;
    configs: Record<string, Config>;
    secrets: Record<string, Record<string, string>>;  // configName -> key -> value
}

class StateManager {
    private state: State | null = null;
    private key: Buffer | null = null;

    // Load state from disk (decrypt) - called once on startup
    async load(): Promise<void>;

    // Persist state to disk (encrypt) - called on every mutation
    private async persist(): Promise<void>;

    // Config operations (auto-persist)
    getConfig(name: string): Config | null;
    setConfig(name: string, config: Config): Promise<void>;
    deleteConfig(name: string): Promise<void>;
    listConfigs(): ConfigSummary[];
    getActiveConfig(): Config | null;
    setActiveConfig(name: string): Promise<void>;

    // Secret operations (auto-persist)
    getSecret(configName: string, key: string): string | null;
    setSecret(configName: string, key: string, value: string): Promise<void>;
    deleteSecret(configName: string, key: string): Promise<void>;
    listSecrets(configName: string): string[];
}
```

### File Structure

```
.noorm/
└── state.enc              # Single encrypted file containing all state
```

### Encrypted Payload Format

```typescript
interface EncryptedPayload {
    version: 1;                    // Schema version for future upgrades
    algorithm: 'aes-256-gcm';
    iv: string;                    // Base64 encoded
    authTag: string;               // Base64 encoded (GCM auth tag)
    ciphertext: string;            // Base64 encoded
    salt: string;                  // Base64 encoded (for key derivation)
}
```

### Key Derivation

```typescript
// Machine ID sources (in order of preference)
// 1. macOS: IOPlatformUUID from IOKit
// 2. Linux: /etc/machine-id or /var/lib/dbus/machine-id
// 3. Windows: MachineGuid from registry
```

### Security Model

- **AES-256-GCM** for authenticated encryption
- **PBKDF2** with machine ID + optional passphrase for key derivation
- **Unique salt per file** - Prevents rainbow table attacks
- **Auth tag** - Detects tampering
- **Single encrypted file** - Atomic writes, no partial state
- **No secrets in env vars by default** - Unless explicitly using `NOORM_*` vars in CI

### Optional Passphrase

For additional security (team environments, shared machines):

```bash
# Set passphrase for this session
export NOORM_PASSPHRASE="team-secret"

# Or prompt interactively
noorm config add  # Will prompt for passphrase if NOORM_PASSPHRASE not set
```

If passphrase is used, it's combined with machine ID:
- Same machine + wrong passphrase = decryption fails
- Different machine + right passphrase = decryption fails
- Same machine + right passphrase = decryption succeeds


## Template Variables

Eta templates can access:

- `dialect` - Current database dialect
- `types` - Dialect-specific type mappings
- `config` - Current config object
- `secrets` - Decrypted secrets for current config
- Custom variables passed at runtime


## Resolved Decisions

- [x] Project name: `noorm`
- [x] Schema auto-update: **No** - One way to do things. `build` creates from schema/, `change` evolves existing state. No magic sync.
- [x] Lock manager: **Yes** - Prevent concurrent operations on same database.
- [x] Seed data: **Part of schema** - Use Eta templates to load adjacent data files (js, mjs, json, yml, csv) for seeds and initial config.


## Lock Manager

Prevents concurrent `noorm` operations on the same database.

### Implementation

```sql
-- Advisory lock approach (Postgres)
SELECT pg_advisory_lock(hashtext('noorm_migration_lock'));

-- Or lock table approach (cross-dialect)
CREATE TABLE __noorm_lock__ (
    id INTEGER PRIMARY KEY DEFAULT 1,
    locked_by VARCHAR(255),
    locked_at TIMESTAMP,
    expires_at TIMESTAMP,
    CONSTRAINT single_row CHECK (id = 1)
);
```

### Behavior

- Acquire lock before any state-modifying operation
- Lock includes identity + timestamp
- Auto-expire after configurable timeout (default: 10 minutes)
- `noorm lock status` - Check current lock state
- `noorm lock release` - Force release (requires confirmation on protected configs)


## Data Loading in Templates

Eta templates can load adjacent data files for seeds, configuration, and dynamic SQL generation.

### Supported Formats

| Extension | Loaded As |
|-----------|-----------|
| `.json` | Parsed JSON object |
| `.yml` / `.yaml` | Parsed YAML object |
| `.csv` | Array of objects (header row = keys) |
| `.js` / `.mjs` | Executed, default export used |
| `.sql` | Raw string (for includes) |

### Usage in Templates

```sql
-- schema/003_seed_users.sql.eta
<% const users = await load('seeds/users.json') %>
<% const roles = await load('seeds/roles.csv') %>
<% const config = await load('config/defaults.yml') %>

INSERT INTO roles (name, permissions) VALUES
<% roles.forEach((role, i) => { %>
    ('<%= role.name %>', '<%= JSON.stringify(role.permissions) %>')<%= i < roles.length - 1 ? ',' : '' %>
<% }) %>;

INSERT INTO users (email, role_id, settings) VALUES
<% users.forEach((user, i) => { %>
    ('<%= user.email %>',
     (SELECT id FROM roles WHERE name = '<%= user.role %>'),
     '<%= JSON.stringify(config.defaultUserSettings) %>')<%= i < users.length - 1 ? ',' : '' %>
<% }) %>;
```

### Dynamic JS Data

```javascript
// seeds/users.mjs
import { faker } from '@faker-js/faker';

export default Array.from({ length: 100 }, () => ({
    email: faker.internet.email(),
    name: faker.person.fullName(),
    role: faker.helpers.arrayElement(['admin', 'user', 'guest'])
}));
```

```sql
-- schema/004_seed_fake_users.sql.eta
<% const users = await load('seeds/users.mjs') %>

INSERT INTO users (email, name, role_id) VALUES
<% users.forEach((user, i) => { %>
    ('<%= user.email %>', '<%= user.name %>',
     (SELECT id FROM roles WHERE name = '<%= user.role %>'))<%= i < users.length - 1 ? ',' : '' %>
<% }) %>;
```

### Template Context

All templates receive:

```typescript
interface TemplateContext {
    // Data loading
    load: (path: string) => Promise<any>;

    // Environment
    dialect: 'postgres' | 'mysql' | 'sqlite';
    config: Config;
    secrets: Record<string, string>;
    env: Record<string, string>;  // Process env vars

    // Utilities
    include: (path: string) => Promise<string>;  // Include raw SQL
    escape: (value: string) => string;           // SQL escape
}

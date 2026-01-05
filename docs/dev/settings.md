# Settings


## The Problem

Database projects need consistent behavior across team members. Build order matters—tables before views, views before functions. Some folders should only run in test environments. Production configs need extra safeguards.

Environment variables don't capture this complexity. And you can't just hardcode it—each developer might need slight variations.

noorm solves this with settings. A single `.noorm/settings.yml` file defines project-wide behavior: build order, conditional rules, team-defined config templates. It's version controlled and shared, unlike encrypted configs which stay per-machine.


## Settings vs Config

| Aspect | Config | Settings |
|--------|--------|----------|
| Location | `.noorm/state.enc` | `.noorm/settings.yml` |
| Contains | Credentials, secrets | Build rules, paths, stages |
| Version control | Gitignored | Committed |
| Per-machine | Yes (encrypted) | No (shared) |
| CLI management | `noorm config` | `noorm settings` |

> **How is settings.yml found?** noorm walks up the directory tree to find the project root. See [Project Discovery](./project-discovery.md) for details.


## Quick Start

```typescript
import { SettingsManager } from './core/settings'

const settings = new SettingsManager(process.cwd())
await settings.load()

// Get build configuration
const build = settings.getBuild()
console.log('Include:', build.include)

// Check if a stage exists
if (settings.hasStage('prod')) {
    const prodStage = settings.getStage('prod')
    console.log('Production:', prodStage?.description)
}

// Evaluate rules against a config
const paths = settings.getEffectiveBuildPaths({
    name: 'dev',
    type: 'local',
    isTest: false,
    protected: false,
})
console.log('Effective include:', paths.include)
console.log('Effective exclude:', paths.exclude)
```


## File Structure

Settings file lives in `.noorm/settings.yml`:

```yaml
# Build configuration
build:
    include:
        - sql/tables
        - sql/views
        - sql/functions
    exclude:
        - sql/archive

# Path overrides
paths:
    sql: ./db/sql
    changes: ./db/changes

# Conditional rules
rules:
    - match:
          isTest: true
      include:
          - sql/seeds

# Team-defined templates
stages:
    dev:
        description: Local development
        defaults:
            dialect: postgres

# Strict mode
strict:
    enabled: false
    stages: []

# Logging
logging:
    enabled: true
    level: info
    file: .noorm/noorm.log

# Teardown behavior
teardown:
    preserveTables:
        - AppSettings
    postScript: sql/teardown/cleanup.sql
```


## Build Configuration

Control which folders are included in builds.

```yaml
build:
    # Folders to include (filter only, not order)
    include:
        - 01_tables
        - 02_views
        - 03_functions
        - 04_seeds

    # Folders to exclude from all builds
    exclude:
        - archive
        - experiments
```

Key behaviors:

- `include` filters which folders are processed (not execution order)
- `exclude` prevents folders from ever being processed
- Execution order is always alphanumeric—use numeric prefixes to control sequence
- Paths are relative to `paths.sql` directory
- Rules can dynamically modify these lists

```typescript
const build = settings.getBuild()
// { include: ['01_tables', ...], exclude: ['archive', ...] }
```


## Path Configuration

Override default locations for schema and change files.

```yaml
paths:
    sql: ./db/sql
    changes: ./db/changes
```

Defaults:

| Path | Default |
|------|---------|
| `sql` | `./sql` |
| `changes` | `./changes` |

```typescript
const paths = settings.getPaths()
// { sql: './db/sql', changes: './db/changes' }
```


## Stage-Based Rules

Rules conditionally include or exclude folders based on the active config's properties. This enables environment-specific behavior without maintaining separate build scripts.

```yaml
rules:
    # Run seeds only in test environments
    - match:
          isTest: true
      include:
          - sql/seeds

    # Skip destructive scripts on protected configs
    - match:
          protected: true
      exclude:
          - sql/dangerous

    # Complex match: remote test databases
    - match:
          isTest: true
          type: remote
      exclude:
          - sql/heavy-seeds
```


### Match Conditions

All conditions in a rule are AND'd together—every specified condition must be true.

| Condition | Type | Description |
|-----------|------|-------------|
| `name` | string | Config name (exact match) |
| `protected` | boolean | Protected config flag |
| `isTest` | boolean | Test database flag |
| `type` | `'local'` \| `'remote'` | Connection type |

```typescript
import { ruleMatches } from './core/settings'

const match = { isTest: true, type: 'local' }
const config = { name: 'test', type: 'local', isTest: true, protected: false }

ruleMatches(match, config)  // true - both conditions match
```


### Rule Evaluation Order

Rules are evaluated in order. Later rules can override earlier ones:

```yaml
rules:
    # First: include seeds for test databases
    - match:
          isTest: true
      include:
          - sql/seeds

    # Later: but exclude seeds for specific config
    - match:
          name: ci-test
      exclude:
          - sql/seeds
```

For config `ci-test` with `isTest: true`, the second rule wins—seeds are excluded.

```typescript
import { evaluateRules } from './core/settings'

const result = evaluateRules(rules, config)
// {
//     matchedRules: [rule1, rule2],
//     include: ['sql/other'],
//     exclude: ['sql/seeds']
// }
```


### Effective Build Paths

Combine base build config with rule evaluation:

```typescript
const { include, exclude } = settings.getEffectiveBuildPaths({
    name: 'dev',
    type: 'local',
    isTest: false,
    protected: false,
})

// Build only these paths
for (const path of include) {
    if (!exclude.includes(path)) {
        await buildPath(path)
    }
}
```


## Stages

Stages are team-defined config templates. They provide defaults, enforce constraints, and define required secrets. When a developer creates a config from a stage, they get consistent baseline settings.

```yaml
stages:
    dev:
        description: Local development database
        locked: false
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            database: myapp_dev

    prod:
        description: Production database
        locked: true
        defaults:
            dialect: postgres
            protected: true
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Database password
```


### Stage Properties

| Property | Type | Description |
|----------|------|-------------|
| `description` | string | Human-readable description shown in CLI |
| `locked` | boolean | If true, configs cannot be deleted (default: false) |
| `defaults` | object | Default values when creating config from stage |
| `secrets` | array | Required secrets that must be set |


### Stage Defaults

Defaults provide initial values when creating a config. Users can override most values, but some are enforceable constraints:

| Default | Behavior |
|---------|----------|
| `protected: true` | Cannot be overridden to false |
| `isTest: true` | Cannot be overridden to false |
| `dialect` | Cannot be changed after creation |

```typescript
// Check if stage enforces protection
if (settings.stageEnforcesProtected('prod')) {
    // Config cannot set protected: false
}

// Get stage defaults
const defaults = settings.getStageDefaults('prod')
// { dialect: 'postgres', protected: true }
```


### Required Secrets

Secrets can be required at two levels: **universal** (required by all configs) and **stage-specific** (required only by configs matching that stage).

**Universal secrets** are defined at the root level of settings:

```yaml
# Required by ALL configs
secrets:
    - key: ENCRYPTION_KEY
      type: password
      description: App-wide encryption key
```

**Stage secrets** are defined within each stage:

```yaml
stages:
    prod:
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Database password
              required: true

            - key: API_KEY
              type: api_key
              description: Admin API key
              required: false
```

When you use `getRequiredSecrets(stageName)`, universal and stage secrets are merged. A config named `prod` will require both universal secrets and prod-stage secrets.

Secret types control CLI input behavior:

| Type | Behavior |
|------|----------|
| `string` | Plain text input |
| `password` | Masked input, no echo |
| `api_key` | Masked input, validated format |
| `connection_string` | Validated as URI |

```typescript
// Get required secrets for a stage (includes universal + stage-specific)
const secrets = settings.getRequiredSecrets('prod')
// [{ key: 'ENCRYPTION_KEY', ... }, { key: 'DB_PASSWORD', ... }]

// Get only universal secrets
const universal = settings.getUniversalSecrets()
// [{ key: 'ENCRYPTION_KEY', type: 'password', description: '...' }]
```


### Locked Stages

Locked stages prevent config deletion:

```typescript
// Check if stage is locked
if (settings.isStageLockedByName('prod')) {
    console.error('Cannot delete production config')
}
```


## Strict Mode

Strict mode requires certain stages to have configs before operations can run. This prevents accidental operations against wrong databases.

```yaml
strict:
    enabled: true
    stages:
        - dev
        - staging
        - prod
```

When enabled:

- User must have configs matching all required stages
- `noorm config add` prompts to select from predefined stages
- Operations fail if required stages are missing

```typescript
if (settings.isStrictModeEnabled()) {
    const required = settings.getRequiredStages()
    // ['dev', 'staging', 'prod']

    for (const stage of required) {
        if (!state.hasConfig(stage)) {
            throw new Error(`Missing required stage: ${stage}`)
        }
    }
}
```


## Logging Configuration

Configure file-based logging:

```yaml
logging:
    enabled: true
    level: info
    file: .noorm/noorm.log
    maxSize: 10mb
    maxFiles: 5
```

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `true` | Enable file logging |
| `level` | `'info'` | Minimum level: silent, error, warn, info, verbose |
| `file` | `.noorm/noorm.log` | Log file path |
| `maxSize` | `'10mb'` | Rotate when size exceeded |
| `maxFiles` | `5` | Rotated files to keep |

```typescript
const logging = settings.getLogging()
// { enabled: true, level: 'info', file: '.noorm/noorm.log', ... }
```


## Teardown Configuration

Configure database reset and teardown behavior:

```yaml
teardown:
    preserveTables:
        - AppSettings
        - UserRoles
        - AuditLog
    postScript: sql/teardown/cleanup.sql
```

| Property | Default | Description |
|----------|---------|-------------|
| `preserveTables` | `[]` | Tables to always preserve during truncate operations |
| `postScript` | `null` | SQL script to run after schema teardown (relative to project root) |

These settings are applied automatically when using teardown operations:

```typescript
import { truncateData, teardownSchema } from './core/teardown'

// preserveTables from settings are automatically included
const result = await truncateData(db, dialect, {
    preserve: settings.getTeardown()?.preserveTables,
})

// postScript runs after teardown
const teardownResult = await teardownSchema(db, dialect, {
    postScript: settings.getTeardown()?.postScript,
})
```

Use cases:

- **preserveTables** - Lookup tables, configuration tables, or audit logs that should never be truncated
- **postScript** - Re-seed essential data, reset sequences, or run cleanup SQL after teardown


## SettingsManager API

The manager handles loading, saving, and accessing settings.


### Loading Settings

```typescript
const settings = new SettingsManager(projectRoot, {
    settingsDir: '.noorm',      // Optional override
    settingsFile: 'settings.yml' // Optional override
})

// Load from file (or use defaults if missing)
await settings.load()

// Check if loaded
if (!settings.isLoaded) {
    throw new Error('Settings not loaded')
}
```


### Initialization

Create a new settings file with defaults:

```typescript
await settings.init()          // Throws if file exists
await settings.init(true)      // Force overwrite
```


### Mutations

Changes are persisted immediately:

```typescript
// Set a stage
await settings.setStage('staging', {
    description: 'Staging environment',
    locked: true,
    defaults: { dialect: 'postgres', protected: false }
})

// Remove a stage
await settings.removeStage('old-stage')

// Add a rule
await settings.addRule({
    match: { isTest: true },
    include: ['sql/seeds']
})

// Remove a rule by index
await settings.removeRule(0)

// Update build config
await settings.setBuild({
    include: ['sql/tables', 'sql/views'],
    exclude: ['sql/archive']
})

// Update paths config
await settings.setPaths({
    sql: './db/sql',
    changes: './db/changes'
})

// Update strict mode config
await settings.setStrict({
    enabled: true,
    stages: ['dev', 'staging', 'prod']
})

// Update logging config
await settings.setLogging({
    enabled: true,
    level: 'verbose',
    file: '.noorm/debug.log'
})

// Manage universal secrets (required by all stages)
await settings.addUniversalSecret({ key: 'API_KEY', type: 'env' })
await settings.updateUniversalSecret('API_KEY', { key: 'API_KEY', type: 'password' })
await settings.removeUniversalSecret('API_KEY')

// Manage stage-specific secrets
await settings.addStageSecret('prod', { key: 'DB_PASSWORD', type: 'password' })
await settings.updateStageSecret('prod', 'DB_PASSWORD', { key: 'DB_PASSWORD', required: false })
await settings.removeStageSecret('prod', 'DB_PASSWORD')

// Evaluate rules programmatically
const result = settings.evaluateRules({
    name: 'dev',
    type: 'local',
    isTest: true,
    protected: false
})
// { matchedRules: [...], include: [...], exclude: [...] }
```


### Singleton Pattern

For convenience, use the singleton:

```typescript
import { getSettingsManager, resetSettingsManager } from './core/settings'

const settings = getSettingsManager(process.cwd())
await settings.load()

// In tests, reset between tests
resetSettingsManager()
```


## Default Settings

When no `settings.yml` exists, noorm uses these defaults:

```typescript
import { DEFAULT_SETTINGS, createDefaultSettings } from './core/settings'

// Read-only reference
console.log(DEFAULT_SETTINGS)
// {
//     build: { include: ['schema'], exclude: [] },
//     paths: { sql: './sql', changes: './changes' },
//     rules: [],
//     stages: {},
//     strict: { enabled: false, stages: [] },
//     logging: { enabled: true, level: 'info', ... },
//     teardown: { preserveTables: [], postScript: undefined }
// }

// Create fresh copy (avoids shared references)
const fresh = createDefaultSettings()
```

Always use `createDefaultSettings()` when you need a mutable copy. Direct spreading `{ ...DEFAULT_SETTINGS }` creates shallow copies with shared array/object references.


## Validation

Settings are validated on load using Zod schemas:

```typescript
import {
    validateSettings,
    parseSettings,
    SettingsValidationError
} from './core/settings'

try {
    // Throws if invalid
    validateSettings(data)

    // Or parse with defaults applied
    const settings = parseSettings(data)
}
catch (err) {
    if (err instanceof SettingsValidationError) {
        console.error('Invalid settings:', err.errors)
    }
}
```

Validation includes:

- Required fields present
- Valid types for all properties
- Stage secret definitions have valid types
- Rule conditions use valid properties
- No empty match conditions in rules


## Observer Events

Settings operations emit events:

```typescript
import { observer } from './core/observer'

observer.on('settings:loaded', ({ path, settings, fromFile }) => {
    console.log(`Loaded settings from ${path}`)
})

observer.on('settings:saved', ({ path }) => {
    console.log(`Saved settings to ${path}`)
})

observer.on('settings:initialized', ({ path, force }) => {
    console.log(`Initialized settings at ${path}`)
})

observer.on('settings:stage-set', ({ name, stage }) => {
    console.log(`Set stage: ${name}`)
})

observer.on('settings:stage-removed', ({ name }) => {
    console.log(`Removed stage: ${name}`)
})

observer.on('settings:rule-added', ({ rule }) => {
    console.log('Added rule')
})

observer.on('settings:rule-removed', ({ index, rule }) => {
    console.log(`Removed rule at index ${index}`)
})

observer.on('settings:build-updated', ({ build }) => {
    console.log('Updated build config')
})

observer.on('settings:paths-updated', ({ paths }) => {
    console.log('Updated paths config')
})

observer.on('settings:strict-updated', ({ strict }) => {
    console.log('Updated strict mode config')
})

observer.on('settings:logging-updated', ({ logging }) => {
    console.log('Updated logging config')
})
```


## Integration with Config Resolution

Settings affect config operations:

1. **Stage defaults** - Merged when creating config from a stage
2. **Build behavior** - `include`/`exclude` filter what files are processed
3. **Rule evaluation** - Rules checked against active config before each build
4. **Config deletion** - Locked stages prevent config deletion
5. **Secret validation** - Required secrets must be set before config is usable
6. **Strict mode** - Requires configs for specified stages

```typescript
import { resolveConfig } from './core/config'
import { getSettingsManager } from './core/settings'

const settings = getSettingsManager(process.cwd())
await settings.load()

// Resolve config with stage defaults
const config = resolveConfig(state, {
    name: 'prod',
    stage: 'prod',
    settings
})
```

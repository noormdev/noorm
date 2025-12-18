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
        - schema/tables
        - schema/views
        - schema/functions
    exclude:
        - schema/archive

# Path overrides
paths:
    schema: ./db/schema
    changesets: ./db/changesets

# Conditional rules
rules:
    - match:
          isTest: true
      include:
          - schema/seeds

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
```


## Build Configuration

Control which folders are included in builds and their execution order.

```yaml
build:
    # Folders to include, executed in this order
    include:
        - schema/tables
        - schema/views
        - schema/functions
        - schema/seeds

    # Folders to exclude from all builds
    exclude:
        - schema/archive
        - schema/experiments
```

Key behaviors:

- `include` defines execution order (first listed = first executed)
- `exclude` prevents folders from ever being processed
- Paths are relative to project root
- Rules can dynamically modify these lists

```typescript
const build = settings.getBuild()
// { include: ['schema/tables', ...], exclude: ['schema/archive', ...] }
```


## Path Configuration

Override default locations for schema and changeset files.

```yaml
paths:
    schema: ./db/schema
    changesets: ./db/changesets
```

Defaults:

| Path | Default |
|------|---------|
| `schema` | `./schema` |
| `changesets` | `./changesets` |

```typescript
const paths = settings.getPaths()
// { schema: './db/schema', changesets: './db/changesets' }
```


## Stage-Based Rules

Rules conditionally include or exclude folders based on the active config's properties. This enables environment-specific behavior without maintaining separate build scripts.

```yaml
rules:
    # Run seeds only in test environments
    - match:
          isTest: true
      include:
          - schema/seeds

    # Skip destructive scripts on protected configs
    - match:
          protected: true
      exclude:
          - schema/dangerous

    # Complex match: remote test databases
    - match:
          isTest: true
          type: remote
      exclude:
          - schema/heavy-seeds
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
          - schema/seeds

    # Later: but exclude seeds for specific config
    - match:
          name: ci-test
      exclude:
          - schema/seeds
```

For config `ci-test` with `isTest: true`, the second rule wins—seeds are excluded.

```typescript
import { evaluateRules } from './core/settings'

const result = evaluateRules(rules, config)
// {
//     matchedRules: [rule1, rule2],
//     include: ['schema/other'],
//     exclude: ['schema/seeds']
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

Stages can define secrets that must be set before a config is usable:

```yaml
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

Secret types control CLI input behavior:

| Type | Behavior |
|------|----------|
| `string` | Plain text input |
| `password` | Masked input, no echo |
| `api_key` | Masked input, validated format |
| `connection_string` | Validated as URI |

```typescript
// Get required secrets for a stage
const secrets = settings.getRequiredSecrets('prod')
// [{ key: 'DB_PASSWORD', type: 'password', description: '...' }]
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
    include: ['schema/seeds']
})

// Remove a rule by index
await settings.removeRule(0)

// Update build config
await settings.setBuild({
    include: ['schema/tables', 'schema/views'],
    exclude: ['schema/archive']
})

// Update paths config
await settings.setPaths({
    schema: './db/schema',
    changesets: './db/changesets'
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
//     paths: { schema: './schema', changesets: './changesets' },
//     rules: [],
//     stages: {},
//     strict: { enabled: false, stages: [] },
//     logging: { enabled: true, level: 'info', ... }
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

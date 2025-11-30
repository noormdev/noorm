# Config Management


## Overview

Configs define how noorm connects to databases and where to find schema/changeset files. They support:

- Multiple environments (dev, staging, prod)
- Environment variable overrides
- Protected configs for production safety
- Secret injection into templates


## File Structure

```
src/core/
├── config/
│   ├── index.ts           # Public exports
│   ├── types.ts           # Config interfaces
│   ├── validation.ts      # Schema validation
│   ├── env.ts             # Environment variable handling
│   └── resolver.ts        # Merges config sources
```


## Types

```typescript
// src/core/config/types.ts

import { Dialect, ConnectionConfig } from '../connection/types';

export interface Config {
    name: string;
    type: 'local' | 'remote';
    isTest: boolean;
    protected: boolean;

    connection: ConnectionConfig;

    paths: {
        schema: string;       // Relative to project root
        changesets: string;   // Relative to project root
    };

    // Optional identity override
    identity?: string;
}

export interface ConfigInput {
    name?: string;
    type?: 'local' | 'remote';
    isTest?: boolean;
    protected?: boolean;
    connection?: Partial<ConnectionConfig>;
    paths?: Partial<Config['paths']>;
    identity?: string;
}

// What gets shown in listings
export interface ConfigSummary {
    name: string;
    type: 'local' | 'remote';
    isTest: boolean;
    protected: boolean;
    isActive: boolean;
    dialect: Dialect;
    database: string;
}
```


## Environment Variables

All config properties can be overridden via environment variables.

```typescript
// src/core/config/env.ts

import { ConfigInput, Config } from './types';
import { Dialect } from '../connection/types';

const ENV_PREFIX = 'NOORM_';

/**
 * Environment variable mappings.
 */
const ENV_MAP = {
    // Connection
    NOORM_DIALECT: 'connection.dialect',
    NOORM_HOST: 'connection.host',
    NOORM_PORT: 'connection.port',
    NOORM_DATABASE: 'connection.database',
    NOORM_USER: 'connection.user',
    NOORM_PASSWORD: 'connection.password',
    NOORM_SSL: 'connection.ssl',

    // Paths
    NOORM_SCHEMA_PATH: 'paths.schema',
    NOORM_CHANGESET_PATH: 'paths.changesets',

    // Behavior
    NOORM_CONFIG: 'name',           // Which config to use
    NOORM_PROTECTED: 'protected',
    NOORM_IDENTITY: 'identity',

    // Not mapped to config (handled separately)
    // NOORM_YES: skip confirmations
    // NOORM_JSON: json output
    // NOORM_PASSPHRASE: encryption passphrase
} as const;

/**
 * Read config values from environment variables.
 */
export function getEnvConfig(): ConfigInput {
    const config: ConfigInput = {};

    for (const [envVar, path] of Object.entries(ENV_MAP)) {
        const value = process.env[envVar];
        if (value === undefined) continue;

        setNestedValue(config, path, parseEnvValue(envVar, value));
    }

    return config;
}

/**
 * Get the active config name from environment.
 */
export function getEnvConfigName(): string | undefined {
    return process.env.NOORM_CONFIG;
}

/**
 * Check if running in CI mode.
 */
export function isCI(): boolean {
    const ci = process.env.CI;
    return ci === '1' || ci === 'true';
}

/**
 * Check if confirmations should be skipped.
 */
export function shouldSkipConfirmations(): boolean {
    const yes = process.env.NOORM_YES;
    return yes === '1' || yes === 'true';
}

/**
 * Check if output should be JSON.
 */
export function shouldOutputJson(): boolean {
    const json = process.env.NOORM_JSON;
    return json === '1' || json === 'true';
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function parseEnvValue(envVar: string, value: string): any {
    // Port is numeric
    if (envVar === 'NOORM_PORT') {
        const port = parseInt(value, 10);
        if (isNaN(port)) throw new Error(`Invalid ${envVar}: must be a number`);
        return port;
    }

    // Booleans
    if (envVar === 'NOORM_SSL' || envVar === 'NOORM_PROTECTED') {
        return value === '1' || value === 'true';
    }

    // Dialect validation
    if (envVar === 'NOORM_DIALECT') {
        const valid: Dialect[] = ['postgres', 'mysql', 'sqlite', 'mssql'];
        if (!valid.includes(value as Dialect)) {
            throw new Error(`Invalid ${envVar}: must be one of ${valid.join(', ')}`);
        }
        return value;
    }

    return value;
}

function setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) current[part] = {};
        current = current[part];
    }

    current[parts[parts.length - 1]] = value;
}
```


## Config Resolver

Merges config from multiple sources with proper precedence.

```typescript
// src/core/config/resolver.ts

import { Config, ConfigInput } from './types';
import { getEnvConfig, getEnvConfigName } from './env';
import { StateManager } from '../state';
import { validateConfig } from './validation';

/**
 * Priority order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Stored config file
 * 4. Defaults
 */

const DEFAULTS: Partial<Config> = {
    type: 'local',
    isTest: false,
    protected: false,
    paths: {
        schema: './schema',
        changesets: './changesets',
    },
    connection: {
        host: 'localhost',
        pool: { min: 0, max: 10 },
    },
};

export interface ResolveOptions {
    /** Config name to load (overrides env var) */
    name?: string;

    /** CLI flag overrides */
    flags?: ConfigInput;
}

/**
 * Resolve the active config from all sources.
 */
export async function resolveConfig(
    state: StateManager,
    options: ResolveOptions = {}
): Promise<Config | null> {
    // 1. Determine which config to use
    const configName = options.name
        ?? getEnvConfigName()
        ?? state.getActiveConfigName();

    if (!configName) {
        // Check if we have enough env vars to run without a stored config
        const envConfig = getEnvConfig();
        if (envConfig.connection?.dialect && envConfig.connection?.database) {
            return resolveFromEnvOnly(envConfig, options.flags);
        }
        return null;
    }

    // 2. Load stored config
    const stored = state.getConfig(configName);
    if (!stored) {
        throw new Error(`Config "${configName}" not found`);
    }

    // 3. Merge: defaults <- stored <- env <- flags
    const envConfig = getEnvConfig();
    const merged = deepMerge(
        DEFAULTS,
        stored,
        envConfig,
        options.flags ?? {}
    ) as Config;

    // 4. Inject secrets
    const secrets = state.getAllSecrets(configName);
    merged.connection = injectSecrets(merged.connection, secrets);

    // 5. Validate
    validateConfig(merged);

    return merged;
}

/**
 * Build a config purely from environment variables (CI mode).
 */
function resolveFromEnvOnly(envConfig: ConfigInput, flags?: ConfigInput): Config {
    const merged = deepMerge(DEFAULTS, envConfig, flags ?? {}) as Config;

    // Generate a name if not provided
    if (!merged.name) {
        merged.name = '__env__';
    }

    validateConfig(merged);
    return merged;
}

/**
 * Inject secrets into connection config.
 * Secrets are referenced as ${SECRET_NAME} in values.
 */
function injectSecrets<T extends Record<string, any>>(
    obj: T,
    secrets: Record<string, string>
): T {
    const result = { ...obj };

    for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'string') {
            result[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => {
                if (secrets[name] === undefined) {
                    throw new Error(`Secret "${name}" not found`);
                }
                return secrets[name];
            });
        } else if (typeof value === 'object' && value !== null) {
            result[key] = injectSecrets(value, secrets);
        }
    }

    return result;
}

/**
 * Deep merge objects (later values override earlier).
 */
function deepMerge(...objects: Record<string, any>[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const obj of objects) {
        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined) continue;

            if (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value) &&
                typeof result[key] === 'object' &&
                result[key] !== null
            ) {
                result[key] = deepMerge(result[key], value);
            } else {
                result[key] = value;
            }
        }
    }

    return result;
}
```


## Validation

```typescript
// src/core/config/validation.ts

import { Config } from './types';
import { Dialect } from '../connection/types';

export class ConfigValidationError extends Error {
    constructor(
        message: string,
        public field: string
    ) {
        super(message);
        this.name = 'ConfigValidationError';
    }
}

const VALID_DIALECTS: Dialect[] = ['postgres', 'mysql', 'sqlite', 'mssql'];

/**
 * Validate a config object. Throws ConfigValidationError if invalid.
 */
export function validateConfig(config: Config): void {
    // Required fields
    if (!config.name || typeof config.name !== 'string') {
        throw new ConfigValidationError('Config name is required', 'name');
    }

    if (!/^[a-z0-9_-]+$/i.test(config.name)) {
        throw new ConfigValidationError(
            'Config name must contain only letters, numbers, hyphens, and underscores',
            'name'
        );
    }

    // Connection
    if (!config.connection) {
        throw new ConfigValidationError('Connection config is required', 'connection');
    }

    if (!config.connection.dialect) {
        throw new ConfigValidationError('Dialect is required', 'connection.dialect');
    }

    if (!VALID_DIALECTS.includes(config.connection.dialect)) {
        throw new ConfigValidationError(
            `Invalid dialect "${config.connection.dialect}". Must be: ${VALID_DIALECTS.join(', ')}`,
            'connection.dialect'
        );
    }

    if (!config.connection.database) {
        throw new ConfigValidationError('Database name is required', 'connection.database');
    }

    // SQLite doesn't need host/port
    if (config.connection.dialect !== 'sqlite') {
        if (!config.connection.host) {
            throw new ConfigValidationError(
                'Host is required for non-SQLite databases',
                'connection.host'
            );
        }
    }

    // Port validation
    if (config.connection.port !== undefined) {
        if (
            typeof config.connection.port !== 'number' ||
            config.connection.port < 1 ||
            config.connection.port > 65535
        ) {
            throw new ConfigValidationError(
                'Port must be a number between 1 and 65535',
                'connection.port'
            );
        }
    }

    // Paths
    if (!config.paths) {
        throw new ConfigValidationError('Paths config is required', 'paths');
    }

    if (!config.paths.schema) {
        throw new ConfigValidationError('Schema path is required', 'paths.schema');
    }

    if (!config.paths.changesets) {
        throw new ConfigValidationError('Changesets path is required', 'paths.changesets');
    }

    // Type
    if (config.type && !['local', 'remote'].includes(config.type)) {
        throw new ConfigValidationError(
            'Type must be "local" or "remote"',
            'type'
        );
    }
}

/**
 * Validate a partial config (for updates).
 */
export function validateConfigInput(input: Partial<Config>): void {
    if (input.name !== undefined) {
        if (typeof input.name !== 'string' || !/^[a-z0-9_-]+$/i.test(input.name)) {
            throw new ConfigValidationError(
                'Config name must contain only letters, numbers, hyphens, and underscores',
                'name'
            );
        }
    }

    if (input.connection?.dialect !== undefined) {
        if (!VALID_DIALECTS.includes(input.connection.dialect)) {
            throw new ConfigValidationError(
                `Invalid dialect. Must be: ${VALID_DIALECTS.join(', ')}`,
                'connection.dialect'
            );
        }
    }

    if (input.connection?.port !== undefined) {
        if (
            typeof input.connection.port !== 'number' ||
            input.connection.port < 1 ||
            input.connection.port > 65535
        ) {
            throw new ConfigValidationError(
                'Port must be a number between 1 and 65535',
                'connection.port'
            );
        }
    }
}
```


## Protected Config Handling

```typescript
// src/core/config/protection.ts

import { Config } from './types';
import { shouldSkipConfirmations, isCI } from './env';

export type ProtectedAction =
    | 'change:run'
    | 'change:revert'
    | 'change:ff'
    | 'change:next'
    | 'run:build'
    | 'run:file'
    | 'run:dir'
    | 'db:create'
    | 'db:destroy'
    | 'config:rm';

const BLOCKED_ACTIONS: ProtectedAction[] = ['db:destroy'];

const CONFIRM_ACTIONS: ProtectedAction[] = [
    'change:run',
    'change:revert',
    'change:ff',
    'change:next',
    'run:build',
    'run:file',
    'run:dir',
    'db:create',
    'config:rm',
];

export interface ProtectionCheck {
    allowed: boolean;
    requiresConfirmation: boolean;
    confirmationPhrase?: string;
    blockedReason?: string;
}

/**
 * Check if an action is allowed on a config.
 */
export function checkProtection(config: Config, action: ProtectedAction): ProtectionCheck {
    // Non-protected configs allow everything
    if (!config.protected) {
        return { allowed: true, requiresConfirmation: false };
    }

    // Blocked actions
    if (BLOCKED_ACTIONS.includes(action)) {
        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `"${action}" is not allowed on protected config "${config.name}". ` +
                'Connect to the database directly to perform this action.',
        };
    }

    // Actions requiring confirmation
    if (CONFIRM_ACTIONS.includes(action)) {
        // Skip confirmation if NOORM_YES is set (for scripted CI)
        if (shouldSkipConfirmations()) {
            return { allowed: true, requiresConfirmation: false };
        }

        return {
            allowed: true,
            requiresConfirmation: true,
            confirmationPhrase: `yes-${config.name}`,
        };
    }

    // Unknown action - allow by default
    return { allowed: true, requiresConfirmation: false };
}

/**
 * Validate a confirmation phrase.
 */
export function validateConfirmation(config: Config, input: string): boolean {
    return input === `yes-${config.name}`;
}
```


## Public Exports

```typescript
// src/core/config/index.ts

export * from './types';
export { validateConfig, validateConfigInput, ConfigValidationError } from './validation';
export { resolveConfig, type ResolveOptions } from './resolver';
export {
    getEnvConfig,
    getEnvConfigName,
    isCI,
    shouldSkipConfirmations,
    shouldOutputJson,
} from './env';
export {
    checkProtection,
    validateConfirmation,
    type ProtectedAction,
    type ProtectionCheck,
} from './protection';
```


## Usage Examples

### Creating a Config

```typescript
import { getStateManager } from './core/state';
import { validateConfig } from './core/config';

const state = await getStateManager();

const config = {
    name: 'dev',
    type: 'local' as const,
    isTest: false,
    protected: false,
    connection: {
        dialect: 'postgres' as const,
        host: 'localhost',
        port: 5432,
        database: 'myapp_dev',
        user: 'postgres',
        password: 'postgres',
    },
    paths: {
        schema: './schema',
        changesets: './changesets',
    },
};

// Validate before saving
validateConfig(config);

// Save
await state.setConfig(config.name, config);
await state.setActiveConfig(config.name);
```

### Resolving Active Config

```typescript
import { getStateManager } from './core/state';
import { resolveConfig } from './core/config';

const state = await getStateManager();
const config = await resolveConfig(state);

if (!config) {
    console.error('No config found. Run: noorm config add');
    process.exit(1);
}

console.log(`Using config: ${config.name}`);
console.log(`Database: ${config.connection.database}`);
```

### With Secrets

```typescript
// Store a secret
await state.setSecret('prod', 'DB_PASSWORD', 'super-secret-password');

// Config references it
const config = {
    name: 'prod',
    // ...
    connection: {
        // ...
        password: '${DB_PASSWORD}',  // Will be replaced with actual secret
    },
};

await state.setConfig(config.name, config);

// When resolved, secret is injected
const resolved = await resolveConfig(state, { name: 'prod' });
console.log(resolved.connection.password);  // "super-secret-password"
```

### CI Mode (Env Vars Only)

```bash
# No stored config needed - everything from env
NOORM_DIALECT=postgres \
NOORM_HOST=db.example.com \
NOORM_DATABASE=myapp \
NOORM_USER=deploy \
NOORM_PASSWORD=$DB_PASSWORD \
noorm run build
```

```typescript
import { resolveConfig } from './core/config';
import { StateManager } from './core/state';

// Even with empty state, resolveConfig works if env vars are set
const state = new StateManager(process.cwd());
await state.load();

const config = await resolveConfig(state);
// config.name === '__env__'
// config.connection populated from NOORM_* vars
```

### Protected Config Check

```typescript
import { resolveConfig, checkProtection } from './core/config';

const config = await resolveConfig(state);
const check = checkProtection(config, 'db:destroy');

if (!check.allowed) {
    console.error(check.blockedReason);
    process.exit(1);
}

if (check.requiresConfirmation) {
    const input = await prompt(`Type "${check.confirmationPhrase}" to confirm:`);
    if (input !== check.confirmationPhrase) {
        console.error('Confirmation failed');
        process.exit(1);
    }
}

// Proceed with action...
```


## Default Ports by Dialect

| Dialect | Default Port |
|---------|--------------|
| postgres | 5432 |
| mysql | 3306 |
| mssql | 1433 |
| sqlite | N/A |


## Testing

```typescript
import { validateConfig, ConfigValidationError } from './core/config';

describe('Config Validation', () => {
    const validConfig = {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        protected: false,
        connection: {
            dialect: 'sqlite' as const,
            database: ':memory:',
        },
        paths: {
            schema: './schema',
            changesets: './changesets',
        },
    };

    it('should accept valid config', () => {
        expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it('should reject missing name', () => {
        const invalid = { ...validConfig, name: '' };
        expect(() => validateConfig(invalid)).toThrow(ConfigValidationError);
    });

    it('should reject invalid dialect', () => {
        const invalid = {
            ...validConfig,
            connection: { ...validConfig.connection, dialect: 'oracle' as any },
        };
        expect(() => validateConfig(invalid)).toThrow(/Invalid dialect/);
    });

    it('should reject invalid port', () => {
        const invalid = {
            ...validConfig,
            connection: { ...validConfig.connection, port: 99999 },
        };
        expect(() => validateConfig(invalid)).toThrow(/Port must be/);
    });
});

describe('Config Resolution', () => {
    it('should merge env vars over stored config', async () => {
        process.env.NOORM_HOST = 'override.local';

        const config = await resolveConfig(state, { name: 'dev' });
        expect(config.connection.host).toBe('override.local');

        delete process.env.NOORM_HOST;
    });

    it('should inject secrets', async () => {
        await state.setSecret('dev', 'PASSWORD', 'secret123');
        await state.setConfig('dev', {
            ...validConfig,
            name: 'dev',
            connection: {
                ...validConfig.connection,
                password: '${PASSWORD}',
            },
        });

        const config = await resolveConfig(state, { name: 'dev' });
        expect(config.connection.password).toBe('secret123');
    });
});
```

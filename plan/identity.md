# Identity Resolution


## Overview

Identity determines "who" executed a changeset or SQL file. Used for audit trails in tracking tables. Resolution priority:

1. Config override (explicit identity in config)
2. Environment variable (`NOORM_IDENTITY`)
3. Git user (`git config user.name` + `user.email`)
4. System user (`os.userInfo().username`)


## Dependencies

```json
{
    "@logosdx/observer": "^x.x.x",
    "@logosdx/utils": "^x.x.x"
}
```


## File Structure

```
src/core/
├── identity/
│   ├── index.ts           # Public exports
│   ├── resolver.ts        # Identity resolution logic
│   └── types.ts           # Identity interfaces
```


## Types

```typescript
// src/core/identity/types.ts

export type IdentitySource = 'config' | 'env' | 'git' | 'system';

export interface Identity {
    name: string;
    email?: string;
    source: IdentitySource;
}

export interface IdentityOptions {
    /** Override from config */
    configIdentity?: string;

    /** Skip git lookup (faster, for CI) */
    skipGit?: boolean;
}
```


## Resolver

```typescript
// src/core/identity/resolver.ts

import { execSync } from 'child_process';
import { userInfo } from 'os';
import { attempt } from '@logosdx/utils';
import { Identity, IdentityOptions, IdentitySource } from './types';
import { observer } from '../observer';

/**
 * Resolve the current user's identity.
 *
 * Priority:
 * 1. Config override
 * 2. NOORM_IDENTITY env var
 * 3. Git user
 * 4. System user
 */
export function resolveIdentity(options: IdentityOptions = {}): Identity {
    let identity: Identity;

    // 1. Config override
    if (options.configIdentity) {
        identity = parseIdentityString(options.configIdentity, 'config');
    }
    // 2. Environment variable
    else if (process.env.NOORM_IDENTITY) {
        identity = parseIdentityString(process.env.NOORM_IDENTITY, 'env');
    }
    // 3. Git user
    else if (!options.skipGit) {
        const gitIdentity = getGitIdentity();
        identity = gitIdentity ?? getSystemIdentity();
    }
    // 4. System user
    else {
        identity = getSystemIdentity();
    }

    observer.emit('identity:resolved', {
        name: identity.name,
        email: identity.email,
        source: identity.source
    });

    return identity;
}

/**
 * Parse an identity string like "Name <email>" or just "Name".
 */
function parseIdentityString(input: string, source: IdentitySource): Identity {
    // Match "Name <email>" format
    const match = input.match(/^(.+?)\s*<([^>]+)>$/);

    if (match) {
        return {
            name: match[1].trim(),
            email: match[2].trim(),
            source,
        };
    }

    // Just a name
    return {
        name: input.trim(),
        source,
    };
}

/**
 * Get identity from git config.
 */
function getGitIdentity(): Identity | null {
    try {
        const name = execSync('git config user.name', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        if (!name) return null;

        let email: string | undefined;
        try {
            email = execSync('git config user.email', {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
        } catch {
            // Email is optional
        }

        return {
            name,
            email: email || undefined,
            source: 'git',
        };
    } catch {
        // Git not available or not in a repo
        return null;
    }
}

/**
 * Get identity from system user.
 */
function getSystemIdentity(): Identity {
    const info = userInfo();

    return {
        name: info.username,
        source: 'system',
    };
}

/**
 * Format identity for display.
 */
export function formatIdentity(identity: Identity): string {
    if (identity.email) {
        return `${identity.name} <${identity.email}>`;
    }
    return identity.name;
}

/**
 * Format identity for database storage.
 */
export function identityToString(identity: Identity): string {
    return formatIdentity(identity);
}
```


## Caching

Identity resolution can be cached for the duration of a command since it won't change mid-execution.

```typescript
// src/core/identity/index.ts

import { Identity, IdentityOptions } from './types';
import { resolveIdentity as resolve, formatIdentity, identityToString } from './resolver';

export * from './types';
export { formatIdentity, identityToString } from './resolver';

let cachedIdentity: Identity | null = null;

/**
 * Get the current identity (cached).
 */
export function resolveIdentity(options: IdentityOptions = {}): Identity {
    // Don't cache if using config override (might change between calls)
    if (options.configIdentity) {
        return resolve(options);
    }

    if (!cachedIdentity) {
        cachedIdentity = resolve(options);
    }

    return cachedIdentity;
}

/**
 * Clear the identity cache (for testing).
 */
export function clearIdentityCache(): void {
    cachedIdentity = null;
}

/**
 * Get identity with config awareness.
 */
export function getIdentityForConfig(config: { identity?: string }): Identity {
    return resolveIdentity({ configIdentity: config.identity });
}
```


## Usage Examples

### Basic Resolution

```typescript
import { resolveIdentity, formatIdentity } from './core/identity';

const identity = resolveIdentity();

console.log(`Executed by: ${formatIdentity(identity)}`);
// "Executed by: John Doe <john@example.com>"

console.log(`Source: ${identity.source}`);
// "Source: git"
```

### With Config Override

```typescript
import { getIdentityForConfig } from './core/identity';

const config = {
    name: 'prod',
    identity: 'Deploy Bot <deploy@example.com>',
    // ...
};

const identity = getIdentityForConfig(config);
// { name: 'Deploy Bot', email: 'deploy@example.com', source: 'config' }
```

### In CI Environment

```bash
# Set identity via env var
NOORM_IDENTITY="GitHub Actions" noorm run build
```

```typescript
// Identity will resolve to:
// { name: 'GitHub Actions', source: 'env' }
```

### Skip Git Lookup

```typescript
// For faster resolution in CI where git user isn't configured
const identity = resolveIdentity({ skipGit: true });
// Falls through to system user immediately
```


## Integration with Tracking

```typescript
import { resolveIdentity, identityToString } from './core/identity';

async function trackFileExecution(
    db: Kysely<any>,
    filepath: string,
    config: Config,
    status: 'success' | 'failed'
) {
    const identity = resolveIdentity({ configIdentity: config.identity });

    await db.insertInto('__change_files__').values({
        filepath,
        checksum: await hashFile(filepath),
        executed_by: identityToString(identity),
        identity_source: identity.source,
        config_name: config.name,
        status,
        executed_at: new Date(),
    }).execute();
}
```


## Testing

```typescript
import {
    resolveIdentity,
    clearIdentityCache,
    formatIdentity,
} from './core/identity';

describe('Identity', () => {
    beforeEach(() => {
        clearIdentityCache();
        delete process.env.NOORM_IDENTITY;
    });

    it('should resolve from config override', () => {
        const identity = resolveIdentity({
            configIdentity: 'Test User <test@example.com>',
        });

        expect(identity.name).toBe('Test User');
        expect(identity.email).toBe('test@example.com');
        expect(identity.source).toBe('config');
    });

    it('should resolve from env var', () => {
        process.env.NOORM_IDENTITY = 'CI Bot';

        const identity = resolveIdentity();

        expect(identity.name).toBe('CI Bot');
        expect(identity.source).toBe('env');
    });

    it('should parse identity with email', () => {
        const identity = resolveIdentity({
            configIdentity: 'John Doe <john@example.com>',
        });

        expect(identity.name).toBe('John Doe');
        expect(identity.email).toBe('john@example.com');
    });

    it('should parse identity without email', () => {
        const identity = resolveIdentity({
            configIdentity: 'John Doe',
        });

        expect(identity.name).toBe('John Doe');
        expect(identity.email).toBeUndefined();
    });

    it('should format identity correctly', () => {
        expect(formatIdentity({ name: 'John', email: 'john@example.com', source: 'git' }))
            .toBe('John <john@example.com>');

        expect(formatIdentity({ name: 'John', source: 'system' }))
            .toBe('John');
    });

    it('should cache identity', () => {
        const first = resolveIdentity();
        const second = resolveIdentity();

        expect(first).toBe(second); // Same reference
    });

    it('should not cache config overrides', () => {
        const first = resolveIdentity({ configIdentity: 'User A' });
        const second = resolveIdentity({ configIdentity: 'User B' });

        expect(first.name).toBe('User A');
        expect(second.name).toBe('User B');
    });

    it('should fall back to system user', () => {
        const identity = resolveIdentity({ skipGit: true });

        expect(identity.source).toBe('system');
        expect(identity.name).toBeTruthy();
    });
});
```


## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No git installed | Falls back to system user |
| Git installed but no user.name | Falls back to system user |
| Empty NOORM_IDENTITY | Treated as not set, continues to git |
| Malformed email in identity string | Parsed as name only |
| Non-ASCII characters | Supported in name and email |

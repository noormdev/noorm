/**
 * Identity resolution logic.
 *
 * Resolves the current user's audit identity from multiple sources
 * with the following priority:
 * 1. Config override (for bots)
 * 2. Cryptographic identity from state
 * 3. NOORM_IDENTITY env var (for CI)
 * 4. Git user
 * 5. System user
 */
import { execSync } from 'child_process';
import { userInfo } from 'os';
import { attemptSync } from '@logosdx/utils';
import type { CryptoIdentity, Identity, IdentityOptions, IdentitySource } from './types.js';
import { observer } from '../observer.js';

/**
 * Resolve the current user's audit identity.
 *
 * Priority chain:
 * 1. Config override (explicit bot/service identity)
 * 2. Cryptographic identity from state (normal user)
 * 3. NOORM_IDENTITY env var (CI pipelines)
 * 4. Git user (developer workstation)
 * 5. System user (fallback)
 *
 * @example
 * ```typescript
 * const identity = resolveIdentity()
 * console.log(`Executed by: ${identity.name}`)
 * ```
 *
 * @example
 * ```typescript
 * // With crypto identity from state
 * const identity = resolveIdentity({
 *     cryptoIdentity: state.identity,
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With config override (for bots)
 * const identity = resolveIdentity({
 *     configIdentity: 'Deploy Bot <deploy@example.com>',
 * })
 * ```
 */
export function resolveIdentity(options: IdentityOptions = {}): Identity {

    let identity: Identity;

    // 1. Config override (explicit bot/service identity)
    if (options.configIdentity) {

        identity = parseIdentityString(options.configIdentity, 'config');

    }
    // 2. Cryptographic identity from state
    else if (options.cryptoIdentity) {

        identity = cryptoIdentityToAuditIdentity(options.cryptoIdentity);

    }
    // 3. Environment variable (CI)
    else if (process.env['NOORM_IDENTITY']) {

        identity = parseIdentityString(process.env['NOORM_IDENTITY'], 'env');

    }
    // 4. Git user
    else if (!options.skipGit) {

        const gitIdentity = getGitIdentity();
        identity = gitIdentity ?? getSystemIdentity();

    }
    // 5. System user
    else {

        identity = getSystemIdentity();

    }

    observer.emit('identity:resolved', {
        name: identity.name,
        email: identity.email,
        source: identity.source,
    });

    return identity;

}

/**
 * Convert cryptographic identity to audit identity.
 *
 * Extracts the name/email for tracking purposes.
 */
function cryptoIdentityToAuditIdentity(crypto: CryptoIdentity): Identity {

    return {
        name: crypto.name,
        email: crypto.email,
        source: 'state',
    };

}

/**
 * Parse an identity string like "Name <email>" or just "Name".
 *
 * @example
 * ```typescript
 * parseIdentityString('John Doe <john@example.com>', 'config')
 * // { name: 'John Doe', email: 'john@example.com', source: 'config' }
 *
 * parseIdentityString('John Doe', 'env')
 * // { name: 'John Doe', source: 'env' }
 * ```
 */
function parseIdentityString(input: string, source: IdentitySource): Identity {

    // Trim leading/trailing whitespace first
    const trimmed = input.trim();

    // Match "Name <email>" format
    const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);

    if (match) {

        return {
            name: match[1]!.trim(),
            email: match[2]!.trim(),
            source,
        };

    }

    // Just a name
    return {
        name: trimmed,
        source,
    };

}

/**
 * Get identity from git config.
 *
 * Returns null if git is not available or user.name is not configured.
 */
function getGitIdentity(): Identity | null {

    const [name, nameErr] = attemptSync(() =>
        execSync('git config user.name', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
    );

    if (nameErr || !name) return null;

    const [email] = attemptSync(() =>
        execSync('git config user.email', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
    );

    return {
        name,
        email: email || undefined,
        source: 'git',
    };

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
 *
 * @example
 * ```typescript
 * formatIdentity({ name: 'John', email: 'john@example.com', source: 'git' })
 * // 'John <john@example.com>'
 *
 * formatIdentity({ name: 'John', source: 'system' })
 * // 'John'
 * ```
 */
export function formatIdentity(identity: Identity): string {

    if (identity.email) {

        return `${identity.name} <${identity.email}>`;

    }

    return identity.name;

}

/**
 * Format identity for database storage.
 *
 * Same as formatIdentity - returns "Name <email>" or just "Name".
 */
export function identityToString(identity: Identity): string {

    return formatIdentity(identity);

}

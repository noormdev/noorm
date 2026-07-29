/**
 * Smart Redaction
 *
 * Masks sensitive fields in log data with intelligent formatting.
 * Uses O(1) Set lookup with all case variations for fast matching.
 *
 * Features:
 * - Max 12 mask chars + "..." for overflow
 * - First 4 chars visible in verbose/debug mode
 * - All case variations (camelCase, snake_case, kebab-case, etc.)
 * - Dynamic secret registration via observer events
 *
 * @example
 * ```typescript
 * maskValue('mysecretpassword', 'Password', 'info')
 * // => '<Password ************... (16) />'
 *
 * maskValue('mysecretpassword', 'Password', 'verbose')
 * // => '<Password myse********... (16) />'
 * ```
 */
import { observer } from '../observer.js';
import type { Settings } from '../settings/types.js';
import type { LogLevel } from './types.js';

const MASK_MAX_LENGTH = 12;

// Set of all masked field name variations (O(1) lookup)
const MASKED_FIELDS = new Set<string>();

// ─────────────────────────────────────────────────────────────
// Case Conversion Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Convert string to camelCase.
 */
function toCamelCase(str: string): string {

    return str
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, (c) => c.toLowerCase());

}

/**
 * Convert string to snake_case.
 */
function toSnakeCase(str: string): string {

    return str
        .replace(/[-\s]+/g, '_')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase();

}

/**
 * Convert string to kebab-case.
 */
function toKebabCase(str: string): string {

    return str
        .replace(/[_\s]+/g, '-')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();

}

/**
 * Convert string to Title Case.
 */
function toTitleCase(str: string): string {

    return str
        .replace(/[-_\s]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');

}

/**
 * Remove all separators from string.
 */
function cleanStr(str: string): string {

    return str.replace(/[-_\s]/g, '');

}

// ─────────────────────────────────────────────────────────────
// Field Registration
// ─────────────────────────────────────────────────────────────

/**
 * Add case variations of field names to masked set.
 * Generates: camelCase, snake_case, kebab-case, Title Case, etc.
 *
 * @param fields - Field names to add
 */
export function addMaskedFields(fields: string[]): void {

    for (const field of fields) {

        // Add with noorm_ prefix variants (NOORM_* env vars)
        const variants = [field, `noorm_${field}`];

        for (const variant of variants) {

            // Original
            MASKED_FIELDS.add(variant);

            // Case variations
            MASKED_FIELDS.add(variant.toLowerCase());
            MASKED_FIELDS.add(variant.toUpperCase());
            MASKED_FIELDS.add(toCamelCase(variant));
            MASKED_FIELDS.add(toSnakeCase(variant));
            MASKED_FIELDS.add(toKebabCase(variant));
            MASKED_FIELDS.add(toTitleCase(variant));

            // Without separators
            MASKED_FIELDS.add(cleanStr(variant));
            MASKED_FIELDS.add(cleanStr(variant).toLowerCase());
            MASKED_FIELDS.add(cleanStr(variant).toUpperCase());

        }

    }

}

// Initialize with common sensitive fields
addMaskedFields([
    'password',
    'pass',
    'secret',
    'token',
    'key',
    'credential',
    'api_key',
    'apikey',
    'access_key',
    'secret_key',
    'db_pass',
    'db_password',
    'redis_pass',
    'client_secret',
    'private_key',
    'encryption_key',
    'auth_token',
    'bearer_token',
    'jwt_secret',
    'session_secret',

    // This project's own credentials. `addMaskedFields` derives the `noorm_`
    // prefix from the *bare* term only, so `password` yields `NOORM_PASSWORD`
    // but never `NOORM_CONNECTION_PASSWORD` — the compound names the docs and
    // CI actually tell users to set have to be listed in full.
    'connection_password',
    'identity_private_key',
    'password_hash',
    'user_password',
]);

/**
 * Credentials embedded in a URI's authority section.
 *
 * Name-based masking cannot catch these: a DSN is a secret carried in the
 * *value*, under whatever key the caller happened to use (`url`, `dsn`,
 * `connectionString`, or an error message). Only the password is replaced so
 * the host and database stay readable — a redacted DSN is usually the most
 * useful thing in a connection-failure log.
 */
const URI_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]+):([^\s/@]+)@/g;

/**
 * Strip credentials from any URIs found in free text.
 *
 * @param text - Arbitrary string value or error message
 * @returns The text with URI passwords replaced
 *
 * @example
 * ```typescript
 * redactCredentialsInText('postgres://user:hunter2@host/db');
 * // => 'postgres://user:***@host/db'
 * ```
 */
export function redactCredentialsInText(text: string): string {

    return text.replace(URI_CREDENTIALS, '$1:***@');

}

/**
 * Check if a field name should be masked.
 *
 * @param key - Field name to check
 * @returns true if field should be masked
 */
export function isMaskedField(key: string): boolean {

    return MASKED_FIELDS.has(key);

}

// ─────────────────────────────────────────────────────────────
// Masking
// ─────────────────────────────────────────────────────────────

/**
 * Mask a value with asterisks.
 *
 * Format: `<FieldName mask (length) />`
 *
 * @param value - Value to mask
 * @param prefix - Field name for label
 * @param level - Current log level (verbose shows first 4 chars)
 * @returns Masked string
 *
 * @example
 * ```typescript
 * maskValue('mysecretpassword', 'Password', 'info')
 * // => '<Password ************... (16) />'
 *
 * maskValue('mysecretpassword', 'Password', 'verbose')
 * // => '<Password myse********... (16) />'
 * ```
 */
export function maskValue(value: string, prefix: string, level: LogLevel): string {

    const valueLen = value.length;
    const maskLen = Math.min(valueLen, MASK_MAX_LENGTH);
    const reveal = Math.min(Math.ceil(valueLen / 5), 4) || 1;

    let masked = '*'.repeat(maskLen);

    // In verbose/debug mode, show first 4 chars for debugging
    if (level === 'verbose' && valueLen >= 4) {

        const first4 = value.slice(0, reveal);
        masked = first4 + '*'.repeat(Math.max(0, maskLen - 4));

        if (masked.length < maskLen) {

            masked += '*'.repeat(maskLen - masked.length);

        }

    }

    // Add overflow indicator
    if (valueLen > MASK_MAX_LENGTH) {

        masked += '...';

    }

    // Format: <FieldName mask (length) />
    const label = toTitleCase(prefix);

    return `<${label} ${masked} (${valueLen}) />`;

}

// ─────────────────────────────────────────────────────────────
// Settings Integration
// ─────────────────────────────────────────────────────────────

/**
 * Add settings-defined secrets to masked fields.
 *
 * Extracts secret field names from stage definitions.
 *
 * @param settings - Settings object with stages
 */
export function addSettingsSecrets(settings: Settings): void {

    if (!settings.stages) return;

    for (const stage of Object.values(settings.stages)) {

        if (stage.secrets && Array.isArray(stage.secrets)) {

            // Extract key names from StageSecret objects
            const keys = stage.secrets.map((secret) => secret.key);
            addMaskedFields(keys);

        }

    }

}

/**
 * Listen for secret events and dynamically add keys to masked fields.
 *
 * Call this BEFORE instantiating the logger queue to capture all secrets.
 *
 * @returns Cleanup function to stop listening
 */
export function listenForSecrets(): () => void {

    const cleanups: Array<() => void> = [];

    // Config-scoped secrets
    cleanups.push(
        observer.on('secret:set', ({ key }) => {

            addMaskedFields([key]);

        }),
    );

    // Global secrets
    cleanups.push(
        observer.on('global-secret:set', ({ key }) => {

            addMaskedFields([key]);

        }),
    );

    return () => cleanups.forEach((c) => c());

}

// ─────────────────────────────────────────────────────────────
// Data Filtering
// ─────────────────────────────────────────────────────────────

/**
 * Recursively filter object, masking sensitive fields.
 *
 * Uses O(1) Set lookup for fast field matching.
 * Handles nested objects, skips read-only properties and URL objects.
 *
 * @param entry - Object to filter
 * @param level - Log level (affects masking format)
 * @returns Filtered object with sensitive fields masked
 */
export function filterData(
    entry: Record<string, unknown>,
    level: LogLevel,
): Record<string, unknown> {

    // Null/undefined check
    if (entry === null || entry === undefined) {

        return entry;

    }

    // Not an object
    if (typeof entry !== 'object') {

        return entry;

    }

    // Skip URL objects (read-only getters)
    if (entry instanceof URL) {

        return entry;

    }

    // Skip Date objects
    if (entry instanceof Date) {

        return entry;

    }

    // Errors can't be spread — message/stack are non-enumerable — so clone via
    // property descriptors to keep the prototype, name and any custom fields
    // intact, then scrub the two places a credential actually shows up. Cloning
    // rather than mutating matters: the caller still owns this error and may
    // rethrow it.
    if (entry instanceof Error) {

        const cloned = Object.create(
            Object.getPrototypeOf(entry) as object,
            Object.getOwnPropertyDescriptors(entry),
        ) as Error;

        cloned.message = redactCredentialsInText(entry.message);

        if (typeof cloned.stack === 'string') {

            cloned.stack = redactCredentialsInText(cloned.stack);

        }

        return cloned as unknown as Record<string, unknown>;

    }

    // Handle arrays
    if (Array.isArray(entry)) {

        return entry.map((item) => {

            if (typeof item === 'object' && item !== null) {

                return filterData(item as Record<string, unknown>, level);

            }

            if (typeof item === 'string') {

                return redactCredentialsInText(item);

            }

            return item;

        }) as unknown as Record<string, unknown>;

    }

    // Clone to avoid mutating original
    const filtered = { ...entry };

    for (const key in filtered) {

        // Check if property is writable
        const descriptor = Object.getOwnPropertyDescriptor(filtered, key);

        if (descriptor && !descriptor.writable && !descriptor.set) {

            continue;

        }

        const value = filtered[key];

        // O(1) lookup for masked field
        if (MASKED_FIELDS.has(key) && typeof value === 'string') {

            filtered[key] = maskValue(value, key, level);

        }
        else if (typeof value === 'string') {

            // The key says nothing, so inspect the value: a DSN under `url` or
            // `dsn` is just as much a leak as one under `password`.
            filtered[key] = redactCredentialsInText(value);

        }
        else if (typeof value === 'object' && value !== null) {

            // Recurse into nested objects
            filtered[key] = filterData(value as Record<string, unknown>, level);

        }

    }

    return filtered;

}

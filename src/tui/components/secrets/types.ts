/**
 * Shared types and utilities for secret components.
 */
import type { StageSecret, SecretType } from '../../../core/settings/types.js';

// Re-export for convenience
export type { StageSecret, SecretType };

/**
 * Secret type options for select fields.
 */
export const SECRET_TYPE_OPTIONS = [
    { label: 'String', value: 'string' },
    { label: 'Password', value: 'password' },
    { label: 'API Key', value: 'api_key' },
    { label: 'Connection String', value: 'connection_string' },
] as const;

/**
 * Validation pattern for secret keys.
 * Must start with a letter, contain only letters, digits, and underscores.
 * Allows both uppercase and lowercase (e.g., DB_PASSWORD, db_password, DbPassword).
 */
export const SECRET_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Validate a secret key.
 *
 * @returns Error message if invalid, undefined if valid
 */
export function validateSecretKey(key: string): string | undefined {

    const trimmed = key.trim();

    if (!trimmed) {

        return 'Key is required';

    }

    if (!SECRET_KEY_PATTERN.test(trimmed)) {

        return 'Key must start with a letter, contain only letters, numbers, underscores';

    }

    return undefined;

}

/**
 * Check if a key already exists in a list.
 *
 * @returns Error message if duplicate, undefined if unique
 */
export function checkDuplicateKey(key: string, existingKeys: string[]): string | undefined {

    const trimmed = key.trim();

    if (existingKeys.includes(trimmed)) {

        return 'Secret key already exists';

    }

    return undefined;

}

/**
 * Secret value list item with status.
 *
 * Used by SecretValueList to display secrets with their set/required status.
 */
export interface SecretValueItem {
    /** Secret key name */
    key: string;

    /** Whether this secret is required by settings */
    isRequired: boolean;

    /** Whether this secret has a value set */
    isSet: boolean;

    /** Secret type hint */
    type?: string;

    /** Human-readable description */
    description?: string;

    /** Obfuscated preview of the value (e.g., "********... (24)") */
    maskedValue?: string;
}

/**
 * Summary counts for secret value list.
 */
export interface SecretValueSummary {
    /** Total required secrets */
    required: number;

    /** Required secrets that are missing values */
    missing: number;

    /** Optional secrets (set but not required) */
    optional: number;
}

/**
 * Dialect-specific impersonation strategies.
 *
 * Each supported dialect provides SQL for identity switching and
 * reverting. Unsupported dialects map to null — checked at call
 * time in Context.impersonate().
 */
import type { Dialect } from '../../core/connection/types.js';

import { ImpersonationError } from './types.js';

// ─────────────────────────────────────────────────────────────
// Strategy Interface
// ─────────────────────────────────────────────────────────────

export interface ImpersonationStrategy {
    impersonate: (username: string) => string;
    revert: () => string;
}

// ─────────────────────────────────────────────────────────────
// Username Validation
// ─────────────────────────────────────────────────────────────

const VALID_USERNAME = /^[a-zA-Z0-9_@.\-\\]+$/;

/**
 * Validate username against restrictive character set.
 *
 * Defense-in-depth before dialect-specific quoting. Rejects
 * characters that have no business in a database principal name.
 */
export function validateUsername(username: string): void {

    if (!username || !VALID_USERNAME.test(username)) {

        throw new ImpersonationError(
            `Invalid username for impersonation: "${username}". ` +
            'Only alphanumeric characters, underscores, @, dots, hyphens, and backslashes are allowed.',
        );

    }

}

// ─────────────────────────────────────────────────────────────
// Dialect Quoting
// ─────────────────────────────────────────────────────────────

/**
 * MSSQL single-quote escaping.
 *
 * Doubles any single quotes in the value. Used inside a
 * single-quoted string literal for EXECUTE AS USER.
 */
function mssqlQuote(value: string): string {

    return value.replace(/'/g, "''");

}

/**
 * PostgreSQL single-quote escaping.
 *
 * Doubles any single quotes in the value. Standard SQL escaping
 * for string literals in SET ROLE.
 */
function pgQuote(value: string): string {

    return value.replace(/'/g, "''");

}

// ─────────────────────────────────────────────────────────────
// Strategy Map
// ─────────────────────────────────────────────────────────────

/**
 * Dialect strategy map for impersonation.
 *
 * Supported dialects provide impersonate/revert SQL generators.
 * Unsupported dialects map to null — Context.impersonate() checks
 * this and throws ImpersonationError before borrowing a connection.
 */
export const dialectStrategy: Record<Dialect, ImpersonationStrategy | null> = {

    mssql: {
        impersonate: (username) => `EXECUTE AS USER = '${mssqlQuote(username)}'`,
        revert: () => 'REVERT',
    },

    postgres: {
        impersonate: (username) => `SET ROLE '${pgQuote(username)}'`,
        revert: () => 'RESET ROLE',
    },

    mysql: null,

    sqlite: null,

};

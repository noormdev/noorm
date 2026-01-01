/**
 * SDK Safety Guards.
 *
 * Guards protect against accidental destructive operations
 * on production or protected databases.
 */
import type { Config } from '../core/config/types.js';
import type { CreateContextOptions } from './types.js';

// ─────────────────────────────────────────────────────────────
// Error Classes
// ─────────────────────────────────────────────────────────────

/**
 * Error thrown when requireTest is enabled but config.isTest is false.
 *
 * @example
 * ```typescript
 * const ctx = await createContext({
 *     config: 'prod',
 *     requireTest: true,  // Will throw RequireTestError
 * })
 * ```
 */
export class RequireTestError extends Error {

    override readonly name = 'RequireTestError' as const;

    constructor(public readonly configName: string) {

        super(`Config "${configName}" does not have isTest: true`);

    }

}

/**
 * Error thrown when attempting destructive operations on protected configs.
 *
 * @example
 * ```typescript
 * // If config.protected is true and allowProtected is false
 * await ctx.truncate()  // Throws ProtectedConfigError
 * ```
 */
export class ProtectedConfigError extends Error {

    override readonly name = 'ProtectedConfigError' as const;

    constructor(
        public readonly configName: string,
        public readonly operation: string,
    ) {

        super(`Cannot ${operation} on protected config "${configName}"`);

    }

}

// ─────────────────────────────────────────────────────────────
// Guard Functions
// ─────────────────────────────────────────────────────────────

/**
 * Check if requireTest option is satisfied.
 *
 * @throws RequireTestError if requireTest is true but config.isTest is false
 */
export function checkRequireTest(
    config: Config,
    options: CreateContextOptions,
): void {

    if (options.requireTest && !config.isTest) {

        throw new RequireTestError(config.name);

    }

}

/**
 * Check if operation is allowed on protected config.
 *
 * @throws ProtectedConfigError if config is protected and allowProtected is false
 */
export function checkProtectedConfig(
    config: Config,
    operation: string,
    options: CreateContextOptions,
): void {

    if (config.protected && !options.allowProtected) {

        throw new ProtectedConfigError(config.name, operation);

    }

}

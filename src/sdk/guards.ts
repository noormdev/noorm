/**
 * SDK Safety Guards.
 *
 * Guards protect against accidental destructive operations
 * on production or protected databases.
 */
import { checkConfigPolicy } from '../core/policy/index.js';
import type { Permission } from '../core/policy/index.js';
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
 * Error thrown when the config's access policy blocks a destructive
 * operation — either the role denies it outright, or the role requires
 * confirmation the SDK cannot provide interactively.
 *
 * @example
 * ```typescript
 * // config.access.user is 'operator' — db:reset requires confirmation the SDK can't give
 * await ctx.noorm.db.truncate()  // Throws ProtectedConfigError
 * ```
 */
export class ProtectedConfigError extends Error {

    override readonly name = 'ProtectedConfigError' as const;

    constructor(
        public readonly configName: string,
        public readonly operation: string,
        reason?: string,
    ) {

        super(
            reason
                ? `Cannot ${operation} on config "${configName}": ${reason}`
                : `Cannot ${operation} on protected config "${configName}"`,
        );

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
 * Check if a destructive operation is allowed on a config, given the
 * channel the context was created on.
 *
 * The SDK has no interactive prompt: a permission that resolves to
 * "requires confirmation" (matrix `confirm` cells on the `user` channel)
 * blocks just like an outright denial, naming `NOORM_YES=1` as the
 * scripted opt-in and the CLI/TUI as the interactive route.
 *
 * @throws ProtectedConfigError if the policy denies or requires confirmation
 */
export function checkProtectedConfig(
    config: Config,
    options: Pick<CreateContextOptions, 'channel'>,
    permission: Permission,
    operation: string,
): void {

    const check = checkConfigPolicy(options.channel ?? 'user', config, permission);

    if (!check.allowed) {

        throw new ProtectedConfigError(config.name, operation);

    }

    if (check.requiresConfirmation) {

        throw new ProtectedConfigError(
            config.name,
            operation,
            'requires confirmation — set NOORM_YES=1 for scripted use, or run this via the noorm CLI/TUI to confirm interactively',
        );

    }

}

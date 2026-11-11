/**
 * SDK Safety Guards.
 *
 * Guards protect against accidental destructive operations
 * on production or protected databases.
 */
import { checkConfigPolicy } from '../core/policy/index.js';
import type { Permission } from '../core/policy/index.js';
import { bindPolicyContext, sameTarget } from '../core/config/resolver.js';
import { anchorSslFiles } from '../core/config/anchor.js';
import type { Config } from '../core/config/types.js';
import type { Settings } from '../core/settings/index.js';
import type { CreateContextOptions } from './types.js';
import type { ContextState } from './state.js';
import type { BatchResult } from '../core/runner/index.js';

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
 * Error thrown when `db.reset()` tore the database down and the rebuild did not succeed.
 *
 * The database is left without its schema, so a caller must not continue as if reset worked.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => ctx.noorm.db.reset())
 * if (err instanceof ResetBuildError) console.error(err.result.error)
 * ```
 */
export class ResetBuildError extends Error {

    override readonly name = 'ResetBuildError' as const;

    constructor(public readonly result: BatchResult) {

        const failed = result.files.find((file) => file.status === 'failed');
        const reason = failed
            ? `${failed.filepath}: ${failed.error ?? result.status}`
            : result.error ?? `build status "${result.status}"`;

        super(`Reset tore down the database but the rebuild failed: ${reason}`);

    }

}

/**
 * Error thrown when `disconnect()` ran while a `withConnection` callback was still running.
 *
 * The pinned connection is closed, so shutdown code can tell this apart from a query failure.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => ctx.withConnection(work))
 * if (err instanceof DisconnectedError) return
 * ```
 */
export class DisconnectedError extends Error {

    override readonly name = 'DisconnectedError' as const;

    constructor() {

        super('disconnect() was called while a withConnection callback was running.');

    }

}

/**
 * Error thrown when a namespace method requiring a live connection is
 * called before `connect()` (or after `disconnect()`).
 *
 * @example
 * ```typescript
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.noorm.db.listTables()  // Throws NotConnectedError — never called connect()
 * ```
 */
export class NotConnectedError extends Error {

    override readonly name = 'NotConnectedError' as const;

    constructor() {

        super('Not connected. Call connect() first.');

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
 * blocks just like an outright denial unless the caller pre-confirmed via
 * `options.yes` (the programmatic equivalent of the CLI's `--yes`) —
 * mirrors `db drop`'s CLI gate (`check.requiresConfirmation && !args.yes`).
 * `options.yes` is only consulted once `checkConfigPolicy` has already
 * resolved the channel: on `agent`, `confirm` collapses to deny before this
 * function ever sees a `requiresConfirmation` result, so `yes: true` never
 * unblocks an MCP-channel context.
 *
 * @throws ProtectedConfigError if the policy denies, or requires
 * confirmation that `options.yes` doesn't supply
 */
export function checkProtectedConfig(
    config: Config,
    options: Pick<CreateContextOptions, 'channel' | 'yes'>,
    permission: Permission,
    operation: string,
): void {

    const check = checkConfigPolicy(options.channel ?? 'user', config, permission);

    if (!check.allowed) {

        throw new ProtectedConfigError(config.name, operation, check.blockedReason);

    }

    if (check.requiresConfirmation && !options.yes) {

        throw new ProtectedConfigError(
            config.name,
            operation,
            'requires confirmation — pass --yes, or set NOORM_YES=1 for scripted use, or run this via the noorm CLI/TUI to confirm interactively',
        );

    }

}

/**
 * Bind a config's policy context from SDK settings.
 *
 * SDK state holds raw `Settings`, not a `SettingsProvider`, so this maps
 * `settings.stages` and `access.roles` and passes them to `bindPolicyContext`.
 *
 * @example
 * ```typescript
 * const destination = bindSdkPolicy(destConfig, settings, projectRoot)
 * ```
 */
export function bindSdkPolicy<T extends { name: string; access: Config['access']; connection: Config['connection'] }>(
    config: T,
    settings: Settings,
    projectRoot: string,
    stageNames?: string[],
    isTest?: boolean,
): T {

    return bindPolicyContext(config, {
        roles: settings.access?.roles,
        projectRoot,
        stageIsProtected: (stage) => settings.stages?.[stage]?.defaults?.protected === true,
        stageNames,
        isTest,
    });

}

/**
 * Bind a transfer or vault destination; never trusts the caller's `isTest`.
 *
 * `isTest` comes from the stored config of that name while the target matches; an unstored
 * destination keeps only an `isTest` bound for the same connection target.
 *
 * @example
 * ```typescript
 * const destination = bindSdkDestination(destConfig, this.#state)
 * ```
 */
export function bindSdkDestination(config: Config, state: ContextState): Config {

    const stored = state.stateManager.getConfig(config.name);
    const isTest = stored
        ? stored.isTest === true && sameTarget(stored.connection, config.connection)
        : undefined;

    const bound = bindSdkPolicy(config, state.settings, state.projectRoot, undefined, isTest);

    return { ...bound, connection: anchorSslFiles(bound.connection, state.projectRoot) };

}

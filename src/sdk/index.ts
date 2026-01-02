/**
 * noorm SDK
 *
 * Programmatic access to noorm-managed databases.
 *
 * @example
 * ```typescript
 * import { createContext } from 'noorm/sdk'
 *
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * // Query the database
 * const users = await ctx.query<User>('SELECT * FROM users')
 *
 * // Run SQL files
 * await ctx.runFile('./seeds/users.sql')
 *
 * // Apply changes
 * await ctx.fastForward()
 *
 * await ctx.disconnect()
 * ```
 */
import { initState, getStateManager } from '../core/state/index.js';
import { getSettingsManager, type SettingsManager } from '../core/settings/index.js';
import { getIdentityForConfig } from '../core/identity/index.js';
import { resolveConfig, SettingsProvider } from '../core/config/resolver.js';

import { Context } from './context.js';
import { checkRequireTest } from './guards.js';
import type { CreateContextOptions } from './types.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Adapt SettingsManager to SettingsProvider interface.
 *
 * The resolver uses a minimal interface to avoid circular deps.
 */
function toSettingsProvider(manager: SettingsManager): SettingsProvider {

    return new SettingsProvider(manager);

}

// ─────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────

/**
 * Create an SDK context for programmatic database access.
 *
 * Configuration is resolved using the full priority chain:
 * defaults <- stage <- stored <- env <- flags
 *
 * This enables:
 * - ENV var overrides (`NOORM_*`) for stored configs
 * - Env-only mode (no stored config) for CI/CD
 *
 * @param options - Context creation options
 * @returns Unconnected context (call connect() to use)
 *
 * @example
 * ```typescript
 * // Basic usage with stored config
 * const ctx = await createContext({ config: 'dev' })
 * await ctx.connect()
 *
 * // Require test database for safety in tests
 * const ctx = await createContext({
 *     config: 'test',
 *     requireTest: true,
 * })
 *
 * // Allow destructive ops on protected config
 * const ctx = await createContext({
 *     config: 'staging',
 *     allowProtected: true,
 * })
 *
 * // Env-only mode (CI/CD) - no stored config needed
 * // Requires NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE
 * const ctx = await createContext()
 * ```
 */
export async function createContext<DB = unknown>(
    options: CreateContextOptions = {},
): Promise<Context<DB>> {

    // Resolve project root
    const projectRoot = options.projectRoot ?? process.cwd();

    // Initialize state (may have no configs in CI)
    await initState(projectRoot);
    const state = getStateManager(projectRoot);

    // Load settings (for stage defaults)
    const settingsManager = getSettingsManager(projectRoot);
    await settingsManager.load();
    const settings = settingsManager.settings;

    // Use resolver - applies full priority chain:
    // defaults <- stage <- stored <- env <- flags
    const config = resolveConfig(state, {
        name: options.config,
        stage: options.stage,
        settings: toSettingsProvider(settingsManager),
    });

    if (!config) {

        throw new Error(
            options.config
                ? `Config "${options.config}" not found`
                : 'No config available. Either:\n' +
                  '  - Pass { config: "name" } to use a stored config\n' +
                  '  - Set NOORM_CONFIG env var\n' +
                  '  - Set NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE for env-only mode',
        );

    }

    // Safety guards
    checkRequireTest(config, options);

    // Resolve identity (respecting config override if set)
    const identity = getIdentityForConfig(config);

    return new Context<DB>(config, settings, identity, options, projectRoot);

}

// ─────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────

export { Context } from './context.js';

// Types
export type {
    CreateContextOptions,
    ExecuteResult,
    TransactionContext,
    BuildOptions,
} from './types.js';

// Guards (errors for catching)
export { RequireTestError, ProtectedConfigError } from './guards.js';

// Re-export observer types for event subscriptions
export type { NoormEvents, NoormEventNames } from '../core/observer.js';

// Re-export commonly needed types
export type { Config } from '../core/config/types.js';
export type { Settings } from '../core/settings/index.js';
export type { Identity } from '../core/identity/index.js';
export type { Dialect } from '../core/connection/index.js';
export type {
    TableSummary,
    TableDetail,
    ExploreOverview,
} from '../core/explore/index.js';
export type { TruncateResult, TeardownResult } from '../core/teardown/index.js';
export type { BatchResult, FileResult, RunOptions } from '../core/runner/index.js';
export type {
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeOptions,
    ChangeHistoryRecord,
} from '../core/change/index.js';

// Lock types
export type { Lock, LockStatus, LockOptions } from '../core/lock/index.js';
export { LockAcquireError, LockExpiredError } from '../core/lock/index.js';

// Template types
export type { ProcessResult as TemplateResult } from '../core/template/index.js';

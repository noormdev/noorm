/**
 * noorm SDK
 *
 * Programmatic access to noorm-managed databases.
 *
 * @example
 * ```typescript
 * import { createContext } from 'noorm/sdk'
 *
 * const ctx = await createContext<MyDatabase>({ config: 'dev' })
 * await ctx.connect()
 *
 * // Type-safe queries via Kysely
 * const users = await ctx.kysely
 *     .selectFrom('users')
 *     .selectAll()
 *     .execute()
 *
 * // Run SQL files
 * await ctx.noorm.run.file('./seeds/users.sql')
 *
 * // Apply changes
 * await ctx.noorm.changes.ff()
 *
 * await ctx.disconnect()
 * ```
 */
import { initState, getStateManager } from '../core/state/index.js';
import { getSettingsManager, type SettingsManager } from '../core/settings/index.js';
import { getIdentityForConfig } from '../core/identity/index.js';
import { loadIdentityFromEnv } from '../core/identity/env.js';
import { setKeyOverride, setIdentityOverride } from '../core/identity/storage.js';
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
 * // Env-only mode (CI/CD) - no stored config needed
 * // Requires NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE
 * const ctx = await createContext()
 * ```
 */
export async function createContext<DB = unknown, Procs = object, Funcs = object, Tvfs = object>(
    options: CreateContextOptions = {},
): Promise<Context<DB, Procs, Funcs, Tvfs>> {

    // Resolve project root
    const projectRoot = options.projectRoot ?? process.cwd();

    // Apply env-based identity overrides so CI/headless consumers can
    // decrypt state.enc without writing ~/.noorm/identity.key. Mirrors
    // the CLI entry point (src/cli/index.ts) — if NOORM_IDENTITY_* are
    // set, they win; otherwise disk-based identity is used.
    const envIdentity = loadIdentityFromEnv();

    if (envIdentity) {

        setKeyOverride(envIdentity.privateKey);
        setIdentityOverride(envIdentity.identity);

    }

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

    // Default the channel so guards.ts can always read it off state.options,
    // without every call site (or ContextState fixture) special-casing undefined.
    const resolvedOptions: CreateContextOptions = { ...options, channel: options.channel ?? 'user' };

    return new Context<DB, Procs, Funcs, Tvfs>(config, settings, identity, resolvedOptions, projectRoot);

}

// ─────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────

export { Context } from './context.js';
export { NoormOps } from './noorm-ops.js';

// Namespace classes (for instanceof checks)
export {
    ChangesNamespace,
    RunNamespace,
    DbNamespace,
    LockNamespace,
    VaultNamespace,
    SecretsNamespace,
    TemplatesNamespace,
    TransferNamespace,
    DtNamespace,
    UtilsNamespace,
} from './namespaces/index.js';

// Types
export type {
    CreateContextOptions,
    BuildOptions,
    ExportOptions,
    ImportOptions,
    ExtractArgs,
    ExtractReturn,
} from './types.js';

// Access policy types — `Config.access` (re-exported below) is typed
// `ConfigAccess`, whose fields are typed `Role`; re-exporting all three
// keeps the public surface closed under its own references.
export type { Channel, ConfigAccess, Role } from '../core/policy/index.js';

// TVP (Table-Valued Parameters)
export { tvp } from './tvp.js';
export type { TvpValue } from './tvp.js';

// Guards (errors for catching)
export { RequireTestError, ProtectedConfigError } from './guards.js';

// Impersonation
export { ImpersonationError } from './impersonate/index.js';
export type { ImpersonatedScope } from './impersonate/index.js';

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
export type { TruncateResult, TeardownResult, TeardownPreview } from '../core/teardown/index.js';
export type { BatchResult, FileResult, RunOptions } from '../core/runner/index.js';
export type {
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeOptions,
    ChangeHistoryRecord,
} from '../core/change/index.js';

// Change scaffold types
export type {
    Change,
    ChangeFile,
    ChangeFileType,
    CreateChangeOptions,
    AddFileOptions,
} from '../core/change/types.js';

// Change errors (for catching)
export {
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    ManifestReferenceError,
} from '../core/change/types.js';

// Lock types
export type { Lock, LockStatus, LockOptions } from '../core/lock/index.js';
export { LockAcquireError, LockExpiredError } from '../core/lock/index.js';

// Template types
export type { ProcessResult as TemplateResult } from '../core/template/index.js';

// Transfer types
export type {
    TransferOptions,
    TransferPlan,
    TransferTablePlan,
    TransferResult,
    TransferTableResult,
    ConflictStrategy,
} from '../core/transfer/index.js';

// Vault types
export type {
    VaultSecret,
    VaultStatus,
    VaultCopyOptions,
    VaultCopyResult,
    VaultPropagationResult,
} from '../core/vault/index.js';

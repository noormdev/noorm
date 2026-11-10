/**
 * Config resolver - merges configuration from multiple sources.
 *
 * Priority order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Stored config
 * 4. Stage defaults (from settings.yml)
 * 5. Defaults
 */
import { merge, clone } from '@logosdx/utils';

import type { Config, ConfigInput, CompletenessCheck } from './types.js';
import { getEnvConfigName } from '../environment.js';
import { parseConfig, type ConfigSchemaType } from './schema.js';
import { getEnvConfig } from './index.js';
import { stageFields } from './stage.js';
import type { SettingsManager, StageDefaults } from '../settings/index.js';
import { attachPolicyContext, getPolicyContext, isBuiltinRole, policyTargetIdentity, UnknownAccessRoleError } from '../policy/index.js';
import type { ConfigAccess, RoleDefinition } from '../policy/index.js';

/**
 * Interface for state manager dependency.
 *
 * Using an interface instead of the class to avoid circular dependencies.
 */
export interface StateProvider {
    getConfig(name: string): Config | null;
    getActiveConfigName(): string | null;
    listSecrets(configName: string): string[];
}

/**
 * Interface for settings provider dependency.
 *
 * Settings provide stage definitions and build rules.
 * Optional - config resolution works without settings.
 */
export class SettingsProvider {

    #manager: SettingsManager;

    constructor(manager: SettingsManager) {

        this.#manager = manager;

    }

    /** Get a stage by name */
    getStage(name: string) {

        return this.#manager.getStage(name) ?? null;

    }

    /** Get stage that matches a config name (for auto-linking) */
    findStageForConfig(configName: string) {

        // Auto-link: if a stage exists with same name as config, use it
        return this.#manager.getStage(configName) ?? null;

    }

    /** Get the project-defined role definitions. */
    getRoles() {

        return this.#manager.settings.access?.roles;

    }

    get projectRoot(): string {

        return this.#manager.projectRoot;

    }

}

/**
 * Default config values.
 *
 * `access` is deliberately absent here: it must be decided from what the
 * merged input (stored/env/flags) actually supplied, not injected ahead of
 * it. Merging a default `access` in first would make it "already present"
 * by the time `parseConfig` runs, short-circuiting the legacy `protected`
 * fallback in `withResolvedAccess` and silently opening up any config that
 * only sets legacy `protected: true`. `parseConfig` still defaults absent
 * `access` to `DEFAULT_ACCESS` (via `resolveLegacyAccess`) — just after the
 * merge, from the real inputs, not before it.
 */
const DEFAULTS: ConfigInput = {
    type: 'local',
    isTest: false,
    connection: {
        host: 'localhost',
        pool: { min: 0, max: 10 },
    },
    log: {
        level: 'info',
    },
};

// `pool.idleTimeoutMs` and its alias `pool.idleTimeoutMillis` are one setting:
// a layer that names either replaces whichever the layers below it set.
function mergeLayer(merged: Partial<ConfigInput>, layer: Partial<ConfigInput>): Partial<ConfigInput> {

    const pool = layer.connection?.pool;
    const lower = merged.connection?.pool;

    if (!lower || (pool?.idleTimeoutMs === undefined && pool?.idleTimeoutMillis === undefined)) return merge(merged, layer);

    const { idleTimeoutMs: _idle, idleTimeoutMillis: _alias, ...rest } = lower;

    return merge({ ...merged, connection: { ...merged.connection, pool: rest } }, layer);

}

/** Reject role references that cannot be resolved against project settings. */
export function validateAccessRoles(
    access: ConfigAccess,
    roles: Record<string, unknown> | undefined,
): void {

    for (const role of [access.user, access.agent]) {

        if (role !== false && !isBuiltinRole(role)
            && !Object.hasOwn(roles ?? {}, role)) {

            throw new UnknownAccessRoleError(role);

        }

    }

}

function isProtectedStage(stageName: string, settings: SettingsProvider): boolean {

    return settings.getStage(stageName)?.defaults?.protected === true;

}

interface PolicyBinding {
    roles?: Record<string, RoleDefinition>;
    projectRoot?: string;
    stageIsProtected: (stageName: string) => boolean;

    /** Stage names beyond the config's own (e.g. an explicit `stage` option). */
    stageNames?: string[];

    /**
     * Trusted `isTest` only (never an env/flag overlay on a stored config).
     * Omitted keeps the bound value while the connection target (credentials aside) is unchanged.
     */
    isTest?: boolean;

    validate?: boolean;
}

/**
 * Callers can only add restriction.
 *
 * Approvals are keyed by the bound context, so a site that binds it
 * differently gets a fingerprint no grant matches.
 *
 * @example
 * ```typescript
 * const bound = bindPolicyContext(config, {
 *     roles: settings.access?.roles,
 *     projectRoot,
 *     stageIsProtected: (name) => settings.stages?.[name]?.defaults?.protected === true,
 * })
 * ```
 */
export function bindPolicyContext<T extends { name: string; access: ConfigAccess; connection: Partial<ConfigInput>['connection'] }>(
    config: T,
    binding: PolicyBinding,
): T {

    const { roles, projectRoot, stageIsProtected, stageNames = [], validate = true } = binding;
    const prior = getPolicyContext(config.access);
    const targetIdentity = projectRoot ? policyTargetIdentity(projectRoot, config.connection) : undefined;
    const testTargetIdentity = projectRoot ? policyTargetIdentity(projectRoot, connectionTarget(config.connection)) : undefined;
    const isTest = binding.isTest
        ?? (prior?.isTest === true && testTargetIdentity !== undefined && prior.testTargetIdentity === testTargetIdentity);
    const access = { ...config.access };

    if (validate) validateAccessRoles(access, roles);

    attachPolicyContext(access, {
        roles,
        protectedStage: prior?.protectedStage === true
            || [config.name, ...stageNames].some(stageIsProtected),
        isTest,
        testTargetIdentity,
        targetIdentity,
    });

    return { ...config, access };

}

function applyPolicyContext(
    config: ConfigSchemaType,
    stageNames: string[],
    isTest: boolean,
    settings?: SettingsProvider,
    validate = true,
): ConfigSchemaType {

    if (!settings) return config;

    return bindPolicyContext(config, {
        roles: settings.getRoles?.(),
        projectRoot: settings.projectRoot,
        stageIsProtected: (stageName) => isProtectedStage(stageName, settings),
        stageNames,
        isTest,
        validate,
    });

}

// The lookup name can differ from the merged name (env or flags rename it); both feed the ceiling.
function stageNamesOf(name: string, stage?: string): string[] {

    return stage ? [name, stage] : [name];

}

/** Apply project policy to a stored config without environment overrides. */
export function withConfigPolicy(config: Config, settings: SettingsProvider, validate = true): Config {

    return applyPolicyContext(config, [], config.isTest === true, settings, validate);

}

/**
 * Options for resolving a config.
 */
export interface ResolveOptions {
    /** Config name to load (overrides env var and active config); `false` loads no stored config */
    name?: string | false;

    /** Name for a config resolved without a stored one; wins over `NOORM_NAME`, throws when a stored config is selected or has it */
    unstoredName?: string;

    /** CLI flag overrides */
    flags?: ConfigInput;

    /** Stage name to use for defaults (from --stage flag) */
    stage?: string;

    /** Settings provider for stage lookup */
    settings?: SettingsProvider;
}

/**
 * Message for a config name that has no stored config.
 *
 * Single source of truth: the MCP server (`src/mcp/server.ts`) reuses this
 * so a hidden config's error is byte-identical to an unknown config's.
 *
 * @example
 * configNotFoundMessage('prod') // 'Config "prod" not found'
 */
export const configNotFoundMessage = (name: string): string => `Config "${name}" not found`;

/**
 * Resolve the active config from all sources.
 *
 * Merges config from (lowest to highest priority):
 * 1. Defaults
 * 2. Stage defaults (from settings.yml, if stage provided or config name matches)
 * 3. Stored config (if name provided or active config exists)
 * 4. Environment variables (NOORM_*)
 * 5. CLI flags
 *
 * @example
 * ```typescript
 * const state = await getStateManager()
 * const config = resolveConfig(state)
 *
 * if (!config) {
 *     console.error('No config found. Run: noorm config add')
 *     process.exit(1)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With CLI flag overrides
 * const config = resolveConfig(state, {
 *     name: 'production',
 *     flags: { connection: { host: 'db.example.com' } }
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With stage defaults from settings
 * const config = resolveConfig(state, {
 *     name: 'prod',
 *     stage: 'prod',
 *     settings: settingsManager,
 * })
 * ```
 */
export function resolveConfig(state: StateProvider, options: ResolveOptions = {}): Config | null {

    // 1. Determine which config to use
    const configName = options.name === false
        ? undefined
        : options.name ?? getEnvConfigName()
            ?? (options.flags?.connection ? undefined : state.getActiveConfigName());

    if (!configName) {

        // Inline SDK overrides can supply the missing connection fields too.
        const envConfig = getEnvConfig();
        const stageDefaults = getStageDefaults(
            options.flags?.name ?? envConfig.name ?? '__env__',
            options.stage,
            options.settings,
        );
        const connection = {
            ...stageFields(stageDefaults ?? {}, true).connection,
            ...envConfig.connection,
            ...options.flags?.connection,
        };

        if (options.flags?.connection || (envConfig.connection && connection.dialect && connection.database)) {

            return resolveFromEnvOnly(state, envConfig, options);

        }

        return null;

    }

    // A stored config's name selects its stage and protected-stage ceiling, so it is not renamed per call.
    if (options.unstoredName !== undefined) {

        throw new Error(
            `Cannot apply the name "${options.unstoredName}" to stored config "${configName}". `
            + 'A name applies only when no stored config is used.',
        );

    }

    // 2. Load stored config
    const stored = state.getConfig(configName);
    if (!stored) {

        throw new Error(configNotFoundMessage(configName));

    }

    // 3. Get stage defaults (if settings available)
    const stageDefaults = getStageDefaults(configName, options.stage, options.settings);

    // 4. Merge: defaults <- stage <- stored <- env <- flags
    // Clone DEFAULTS to avoid mutation
    const envConfig = getEnvConfig();
    let merged: Partial<ConfigInput> = clone(DEFAULTS);

    if (stageDefaults) {

        merged = mergeLayer(merged, clone(stageFields(stageDefaults, true)));

    }

    // merge() adopts a layer's nested objects by reference; the overlays below would otherwise write into the stored record.
    merged = mergeLayer(merged, clone(stored));

    // Captured before the env/flag overlays so they cannot grant the isTest relaxation.
    const storedConnection = { ...merged.connection };
    const storedIsTest = stored.isTest === true;

    merged = mergeLayer(merged, envConfig);
    merged = mergeLayer(merged, options.flags ?? {});

    // Same reason as the env-only refusal: secrets, vault lookups and tracking records are keyed by the merged name.
    if (merged.name && merged.name !== configName && state.getConfig(merged.name)) {

        throw new Error(
            `An env or flag name cannot rename config "${configName}" to the name of stored config "${merged.name}". `
            + `Select it with NOORM_CONFIG=${merged.name} or the config option, or choose another name.`,
        );

    }

    const trustedIsTest = storedIsTest && sameTarget(storedConnection, merged.connection);

    return applyPolicyContext(parseConfig(merged), stageNamesOf(configName, options.stage), trustedIsTest, options.settings);

}

/**
 * Get stage defaults for a config.
 *
 * Looks up stage by:
 * 1. Explicit stage name (from --stage flag)
 * 2. Config name matching a stage name
 */
function getStageDefaults(
    configName: string,
    stageName: string | undefined,
    settings: SettingsProvider | undefined,
): StageDefaults | null {

    if (!settings) return null;
    if (stageName) return settings.getStage(stageName)?.defaults ?? null;

    return settings.findStageForConfig(configName)?.defaults ?? null;

}

/**
 * The fields that decide which database a connection reaches (no credentials); sqlite ignores host and port.
 *
 * @example
 * ```typescript
 * const retargeted = connectionTarget(stored.connection) !== connectionTarget(resolved.connection)
 * ```
 */
export function connectionTarget(connection: Partial<ConfigInput>['connection']): string {

    const { dialect, host, port, database, filename } = connection ?? {};

    if (dialect === 'sqlite') return JSON.stringify([dialect, database, filename]);

    return JSON.stringify([dialect, host, port === undefined ? undefined : String(port), database, filename]);

}

/**
 * Whether a resolved connection still reaches the trusted source's database.
 * A port the trusted source leaves undeclared is not part of its target, so an env port is not a retarget.
 */
export function sameTarget(trusted: Partial<ConfigInput>['connection'], resolved: Partial<ConfigInput>['connection']): boolean {

    const declared = { ...DEFAULTS.connection, ...trusted };
    const compared = declared.port === undefined ? { ...resolved, port: undefined } : resolved;

    return connectionTarget(declared) === connectionTarget(compared);

}

interface EnvOnlyTrust {
    parsed: ConfigSchemaType;
    stageDefaults: StageDefaults | null;
    stageNames: string[];
    settings: SettingsProvider | undefined;
    supplied: ConfigInput['connection'];

    /** The name `unstoredName` replaced; a stored config under it still decides. */
    displacedName?: string;
}

/**
 * A stored config or a stage declaring a database decides; otherwise env counts only when no protected stage
 * applies and env or flags supply the target.
 */
function envOnlyIsTest(state: StateProvider, trust: EnvOnlyTrust): boolean {

    const { parsed, stageDefaults, stageNames, settings, supplied, displacedName } = trust;
    const declared = [stageDefaults, ...stageNames.map((stage) => settings?.findStageForConfig(stage)?.defaults)]
        .map((defaults) => defaults?.isTest);

    if (declared.includes(false) || !parsed.isTest) return false;

    const stored = displacedName ? state.getConfig(displacedName) : null;

    if (stored) return stored.isTest === true && sameTarget(stored.connection, parsed.connection);

    const stageTarget = stageDefaults ? stageFields(stageDefaults, true).connection : undefined;

    if (stageDefaults?.isTest === true && stageTarget?.database) {

        return sameTarget(stageTarget, parsed.connection);

    }

    if (settings && stageNames.some((stage) => isProtectedStage(stage, settings))) return false;

    const needsHost = parsed.connection.dialect !== 'sqlite';

    return Boolean(supplied?.database) && (!needsHost || Boolean(supplied?.host));

}

/**
 * Build a config purely from environment variables (CI mode).
 *
 * Useful when no stored config exists but env vars provide all needed values.
 */
function resolveFromEnvOnly(
    state: StateProvider,
    envConfig: ConfigInput,
    options: ResolveOptions,
): Config {

    const { flags, stage: stageName, settings, unstoredName } = options;

    // Flags before env, as in the merge below.
    const fallbackName = flags?.name ?? envConfig.name ?? (flags?.connection ? '__inline__' : '__env__');
    const name = unstoredName ?? fallbackName;
    const displacedName = unstoredName === undefined ? undefined : fallbackName;

    // Secrets, vault lookups and tracking records are keyed by name, so this name would reach the stored config's.
    if (state.getConfig(name)) {

        throw new Error(
            `Cannot name a context "${name}": a stored config is named "${name}". `
            + `Select it with NOORM_CONFIG=${name} or the config option, or choose another name.`,
        );

    }

    // A caller-chosen name restricts and never selects defaults, so they come from the name it displaced.
    const stageDefaults = getStageDefaults(fallbackName, stageName, settings);

    // Merge: defaults <- stage <- env <- flags
    let merged: Partial<ConfigInput> = clone(DEFAULTS);

    if (stageDefaults) {

        merged = mergeLayer(merged, clone(stageFields(stageDefaults, true)));

    }

    merged = mergeLayer(merged, envConfig);
    merged = mergeLayer(merged, flags ?? {});

    merged.name = name;

    const parsed = parseConfig(merged);

    // Both names feed the ceiling and the isTest checks.
    const stageNames = [...stageNamesOf(name, stageName), ...(displacedName ? [displacedName] : [])];
    const supplied = { ...envConfig.connection, ...flags?.connection };
    const trustedIsTest = envOnlyIsTest(state, { parsed, stageDefaults, stageNames, settings, supplied, displacedName });

    return applyPolicyContext(parsed, stageNames, trustedIsTest, settings);

}

/**
 * Options for config completeness check.
 */
export interface CompletenessCheckOptions {
    /** Stage name to check against (defaults to finding stage for config) */
    stageName?: string;

    /** Vault secret keys that are available (count as "set") */
    vaultSecretKeys?: string[];
}

/**
 * Check if a config is complete and usable.
 *
 * A config is complete when all required secrets (from its stage) are set.
 * Secrets can come from local state OR the vault.
 * Also checks for stage constraint violations.
 *
 * @example
 * ```typescript
 * const check = checkConfigCompleteness(config, state, settings, {
 *     vaultSecretKeys: ['API_KEY', 'DB_PASSWORD'],
 * })
 * if (!check.complete) {
 *     console.log('Missing secrets:', check.missingSecrets)
 *     console.log('Violations:', check.violations)
 * }
 * ```
 */
export function checkConfigCompleteness(
    config: Config,
    state: StateProvider,
    settings?: SettingsProvider,
    options?: CompletenessCheckOptions,
): CompletenessCheck {

    const { stageName, vaultSecretKeys = [] } = options ?? {};

    const result: CompletenessCheck = {
        complete: true,
        missingSecrets: [],
        violations: [],
    };

    // Get stage for this config
    const stage = settings
        ? stageName
            ? settings.getStage(stageName)
            : settings.findStageForConfig(config.name)
        : null;

    if (!stage) {

        // No stage = no requirements to check
        return result;

    }

    // Check required secrets (local secrets + vault secrets count as "set")
    const localSecrets = state.listSecrets(config.name);
    const availableSecrets = new Set([...localSecrets, ...vaultSecretKeys]);

    for (const secret of stage.secrets ?? []) {

        const isRequired = secret.required !== false; // Default to true
        if (isRequired && !availableSecrets.has(secret.key)) {

            result.missingSecrets.push(secret.key);

        }

    }

    // Check stage constraint violations
    const defaults = stage.defaults ?? {} as ConfigInput;

    // protected: true is enforced as a policy ceiling at resolution, so it
    // is not a completeness violation.

    // isTest: true cannot be overridden to false
    if (defaults.isTest === true && config.isTest === false) {

        result.violations.push(
            `Stage "${stageName ?? config.name}" requires isTest=true, but config has isTest=false`,
        );

    }

    // Update complete flag
    result.complete = result.missingSecrets.length === 0 && result.violations.length === 0;

    return result;

}

/**
 * Error when a config is linked to a locked stage and cannot be deleted.
 *
 * Thrown by `assertCanDeleteConfig` — the throwing counterpart to
 * `canDeleteConfig`'s bool+reason check.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => stateManager.deleteConfig(name, settings))
 * if (err instanceof ConfigStageLockedError) {
 *     console.log(`Blocked by stage "${err.stageName}"`)
 * }
 * ```
 */
export class ConfigStageLockedError extends Error {

    override readonly name = 'ConfigStageLockedError' as const;

    constructor(
        public readonly configName: string,
        public readonly stageName: string,
    ) {

        super(`Config "${configName}" is linked to locked stage "${stageName}" and cannot be deleted`);

    }

}

/**
 * Check if a config can be deleted.
 *
 * Locked stages prevent config deletion.
 */
export function canDeleteConfig(
    configName: string,
    settings?: SettingsProvider,
    stageName?: string,
): { allowed: boolean; reason?: string } {

    if (!settings) {

        return { allowed: true };

    }

    const stage = stageName
        ? settings.getStage(stageName)
        : settings.findStageForConfig(configName);

    if (stage?.locked) {

        return {
            allowed: false,
            reason: `Config "${configName}" is linked to locked stage "${stageName ?? configName}" and cannot be deleted`,
        };

    }

    return { allowed: true };

}

/**
 * Runs `canDeleteConfig` and throws when denied — the throwing counterpart
 * every deletion seam reaches for, mirroring `checkConfigPolicy`/`assertPolicy`
 * in `core/policy/check.ts`.
 *
 * @throws ConfigStageLockedError when the config's stage is locked.
 *
 * @example
 * assertCanDeleteConfig(configName, settingsProvider);
 */
export function assertCanDeleteConfig(
    configName: string,
    settings?: SettingsProvider,
    stageName?: string,
): void {

    const check = canDeleteConfig(configName, settings, stageName);

    if (!check.allowed) {

        throw new ConfigStageLockedError(configName, stageName ?? configName);

    }

}

/** Thrown when a copy or rename would shed a protected stage's ceiling.
 * @example throw new ProtectedStageEscapeError('copy', 'prod', 'scratch') */
export class ProtectedStageEscapeError extends Error {

    override readonly name = 'ProtectedStageEscapeError' as const;

    constructor(
        public readonly operation: 'copy' | 'rename',
        public readonly source: string,
        public readonly destination: string,
    ) {

        super(`Cannot ${operation} a protected-stage config to an unprotected stage: "${source}" -> "${destination}"`);

    }

}

/** Blocks copy/rename of a protected config to an unprotected name, which would drop its ceiling.
 * @example assertCanMoveProtectedConfig('rename', 'prod', 'scratch', settings) */
export function assertCanMoveProtectedConfig(
    operation: 'copy' | 'rename',
    source: string,
    destination: string,
    settings: SettingsProvider,
): void {

    if (isProtectedStage(source, settings) && !isProtectedStage(destination, settings)) {

        throw new ProtectedStageEscapeError(operation, source, destination);

    }

}

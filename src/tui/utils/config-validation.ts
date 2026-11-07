/**
 * Config form validation utilities.
 *
 * Shared validators for config name, port, and connection
 * config building used by ConfigAdd, ConfigEdit, and ConfigCopy screens.
 *
 * @example
 * ```typescript
 * const error = validateConfigName('dev', existingNames);
 * const config = buildConnectionConfig(values, dialect);
 * ```
 */
import type { FormValues, SelectOption } from '../components/index.js';
import type { ConnectionConfig, Dialect } from '../../core/connection/types.js';
import type { Config } from '../../core/config/types.js';
import type { ConfigAccess } from '../../core/policy/index.js';
import { guarded } from '../../core/policy/index.js';
import { DEFAULT_PORTS } from '../../core/connection/index.js';
import { ConfigNameSchema, PortSchema } from '../../core/config/schema.js';

export { DEFAULT_PORTS };

/**
 * Validates a config name for format and optional uniqueness.
 *
 * Used in form field validators and standalone validation callbacks.
 *
 * @example
 * ```typescript
 * // In form field:
 * validate: (value) => validateConfigName(String(value), existingNames)
 *
 * // In standalone callback:
 * const error = validateConfigName(name, existingNames);
 * ```
 */
export function validateConfigName(
    value: string,
    existingNames?: string[],
): string | undefined {

    const result = ConfigNameSchema.safeParse(value);

    if (!result.success) {

        return result.error.issues[0]?.message ?? 'Invalid config name';

    }

    if (existingNames?.includes(value)) {

        return 'Config name already exists';

    }

    return undefined;

}

/**
 * Validates a port number string.
 *
 * Returns undefined for empty/missing values (port is optional).
 *
 * @example
 * ```typescript
 * validate: (value) => validatePort(String(value))
 * ```
 */
export function validatePort(value: string | undefined): string | undefined {

    if (!value) return undefined;

    const port = parseInt(value, 10);

    if (isNaN(port)) {

        return 'Port must be 1-65535';

    }

    const result = PortSchema.safeParse(port);

    if (!result.success) {

        return result.error.issues[0]?.message ?? 'Invalid port';

    }

    return undefined;

}

/**
 * Connection config defaults for fields not provided.
 */
export interface ConnectionDefaults {

    /** Fallback port when not provided in form values. */
    port?: number;

    /** Fallback password when not provided in form values. */
    password?: string;

}

/**
 * Builds a connection config object from form values.
 *
 * Handles SQLite-conditional fields (host/port/user/password are
 * omitted for SQLite dialect). Applies defaults for missing values.
 *
 * @example
 * ```typescript
 * // ConfigAddScreen (no defaults):
 * const config = buildConnectionConfig(values, dialect);
 *
 * // ConfigEditScreen (preserve existing values):
 * const config = buildConnectionConfig(values, dialect, {
 *     port: existingConfig.connection.port,
 *     password: existingConfig.connection.password,
 * });
 * ```
 */
export function buildConnectionConfig(
    values: FormValues,
    dialect: Dialect,
    defaults?: ConnectionDefaults,
): ConnectionConfig {

    const isSqlite = dialect === 'sqlite';

    return {
        dialect,
        host: isSqlite ? undefined : String(values['host'] || 'localhost'),
        port: isSqlite
            ? undefined
            : values['port']
                ? parseInt(String(values['port']), 10)
                : (defaults?.port ?? DEFAULT_PORTS[dialect]),
        database: String(values['database']),
        user: isSqlite ? undefined : values['user'] ? String(values['user']) : undefined,
        password: isSqlite
            ? undefined
            : values['password']
                ? String(values['password'])
                : defaults?.password,
    };

}

/** Values for role options are encoded so a role named "off" is selectable. */
const AGENT_OFF_VALUE = 'off';

export function getRoleOptions(roles?: Record<string, unknown>): {
    user: SelectOption[];
    agent: SelectOption[];
} {

    const names = [...new Set(['viewer', 'operator', 'admin', ...Object.keys(roles ?? {})])];
    const user = names.map((name) => ({ label: name, value: name }));

    return {
        user,
        agent: [
            { label: 'Off (hidden from agents)', value: AGENT_OFF_VALUE },
            ...names.map((name) => ({ label: name, value: `role:${name}` })),
        ],
    };

}

/**
 * Builds a `ConfigAccess` from the role fields shared by ConfigAdd/ConfigEdit.
 * Role names are validated against project settings when the config is resolved.
 *
 * @example
 * ```typescript
 * buildAccessFromValues({ userRole: 'operator', agentRole: 'off' });
 * // { user: 'operator', agent: false }
 * ```
 */
export function buildAccessFromValues(values: FormValues): ConfigAccess {

    const userRoleValue = String(values['userRole'] ?? 'viewer');
    const agentRoleValue = String(values['agentRole'] ?? AGENT_OFF_VALUE);

    return {
        user: userRoleValue.trim() ? userRoleValue : 'viewer',
        agent: agentRoleValue === AGENT_OFF_VALUE
            ? false
            : agentRoleValue.startsWith('role:')
                ? agentRoleValue.slice(5)
                : agentRoleValue || false,
    };

}

/**
 * `guarded()` narrowed for the TUI's `Config`. Display-only (styling cues),
 * same role as `guarded()` itself — never an enforcement input.
 *
 * @example
 * ```tsx
 * borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}
 * ```
 */
export function isConfigGuarded(config: Config): boolean {

    return guarded(config);

}

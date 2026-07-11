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
import type { ConfigAccess, Role } from '../../core/policy/index.js';
import { guarded } from '../../core/policy/index.js';


/**
 * Default ports by dialect.
 */
export const DEFAULT_PORTS: Record<Dialect, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0,
    mssql: 1433,
};

/**
 * Config name pattern — letters, numbers, hyphens, underscores.
 */
const CONFIG_NAME_PATTERN = /^[a-z0-9_-]+$/i;

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

    if (!value) return 'Name is required';

    if (!CONFIG_NAME_PATTERN.test(value)) {

        return 'Only letters, numbers, hyphens, underscores';

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

    if (isNaN(port) || port < 1 || port > 65535) {

        return 'Port must be 1-65535';

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

/**
 * Select options for the `userRole` field — the `user` channel has no
 * `false`/off state, unlike `mcp`.
 */
export const USER_ROLE_OPTIONS: SelectOption[] = [
    { label: 'Viewer', value: 'viewer' },
    { label: 'Operator', value: 'operator' },
    { label: 'Admin', value: 'admin' },
];

/**
 * Select options for the `mcpRole` field — `off` maps to `access.mcp: false`
 * (invisible to the MCP channel), the one state the `user` channel lacks.
 */
export const MCP_ROLE_OPTIONS: SelectOption[] = [
    { label: 'Off (hidden from MCP)', value: 'off' },
    { label: 'Viewer', value: 'viewer' },
    { label: 'Operator', value: 'operator' },
    { label: 'Admin', value: 'admin' },
];

function isRole(value: string): value is Role {

    return value === 'viewer' || value === 'operator' || value === 'admin';

}

/**
 * Builds a `ConfigAccess` from the `userRole`/`mcpRole` select fields shared
 * by ConfigAdd/ConfigEdit. The select only ever offers valid options, so an
 * unrecognized/missing value should never happen in practice — the fallback
 * is defense-in-depth and fails closed (`viewer`/`false`) rather than
 * granting `admin` on a value it can't recognize.
 *
 * @example
 * ```typescript
 * buildAccessFromValues({ userRole: 'operator', mcpRole: 'off' });
 * // { user: 'operator', mcp: false }
 * ```
 */
export function buildAccessFromValues(values: FormValues): ConfigAccess {

    const userRoleValue = String(values['userRole'] ?? 'viewer');
    const mcpRoleValue = String(values['mcpRole'] ?? 'off');

    return {
        user: isRole(userRoleValue) ? userRoleValue : 'viewer',
        mcp: mcpRoleValue === 'off' ? false : (isRole(mcpRoleValue) ? mcpRoleValue : false),
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

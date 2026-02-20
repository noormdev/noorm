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
import type { FormValues } from '../components/index.js';
import type { ConnectionConfig, Dialect } from '../../core/connection/types.js';


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

/**
 * Default connection ports by dialect.
 *
 * Single source for the port every dialect factory, `same-server.ts`, and
 * the TUI's connection-config builder fall back to when a config omits
 * `port`.
 */
import type { Dialect } from './types.js';

export const DEFAULT_PORTS: Record<Dialect, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0, // Not applicable
    mssql: 1433,
};

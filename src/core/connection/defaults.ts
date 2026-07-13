/**
 * Default connection ports by dialect.
 *
 * Single source for the port every dialect factory, `same-server.ts`, and
 * the TUI's connection-config builder fall back to when a config omits
 * `port`.
 */
import { z } from 'zod';

import type { Dialect } from './types.js';

export const DEFAULT_PORTS: Record<Dialect, number> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: 0, // Not applicable
    mssql: 1433,
};

/**
 * Port number validation. Shared by `core/config` and `core/settings` so the
 * bound has one source of truth.
 */
export const PortSchema = z
    .number()
    .int()
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port must be at most 65535');

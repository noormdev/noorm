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
 * Milliseconds a connection attempt may spend before the driver gives up.
 *
 * Postgres ships with no limit at all — `pg`'s `connectionTimeoutMillis`
 * defaults to `0` — which is why an unreachable host used to wait forever
 * instead of erroring. 15s is tedious's own default, so mssql keeps the
 * behaviour it already had, and it clears the slowest legitimate case by a
 * wide margin: a warm TLS handshake plus login is sub-second even across
 * continents. The one case it does not clear is a serverless database resuming
 * from auto-pause, which is what `connection.connectTimeoutMs` is for.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/**
 * Resolve the connect timeout for a connection config.
 *
 * A non-positive override is treated as absent rather than as "no timeout":
 * every driver here reads `0` as infinite, and silently reinstating the
 * forever-hang is the exact bug this default exists to close.
 *
 * @example
 * const pool = new Pool({ connectionTimeoutMillis: connectTimeoutFor(config) });
 */
export function connectTimeoutFor(config: { connectTimeoutMs?: number }): number {

    const configured = config.connectTimeoutMs;

    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {

        return configured;

    }

    return DEFAULT_CONNECT_TIMEOUT_MS;

}

/**
 * Port number validation. Shared by `core/config` and `core/settings` so the
 * bound has one source of truth.
 */
export const PortSchema = z
    .number()
    .int()
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port must be at most 65535');

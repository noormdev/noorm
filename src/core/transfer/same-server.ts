/**
 * Same-server detection for transfer optimization.
 *
 * Determines if source and destination databases are on the same server,
 * enabling direct INSERT...SELECT transfers without data marshalling.
 */
import type { ConnectionConfig, Dialect } from '../connection/types.js';
import { DEFAULT_PORTS } from '../connection/defaults.js';

/**
 * Normalize a hostname for comparison.
 *
 * Handles common aliases like localhost, 127.0.0.1, etc.
 */
function normalizeHost(host: string | undefined): string {

    const h = (host ?? 'localhost').toLowerCase();

    // Normalize localhost variants
    if (h === '127.0.0.1' || h === '::1' || h === 'localhost.localdomain') {

        return 'localhost';

    }

    return h;

}

/**
 * Check if two connection configs point to the same database instance.
 *
 * Same-server optimization (direct INSERT...SELECT) requires:
 * - Same dialect
 * - Same host (after normalization)
 * - Same port
 * - A dialect that can name the source database in a query
 *
 * PostgreSQL is never "same server". Without dblink/postgres_fdw it cannot
 * reach another database, and when both configs name the *same* database the
 * direct statement degenerates to `INSERT INTO t SELECT ... FROM t` — copying
 * the destination into itself. Neither outcome is a transfer, so postgres
 * always takes the batch path.
 *
 * MySQL and MSSQL can query across databases on the same server.
 *
 * SQLite is never considered "same server" since there's no server.
 *
 * @param source - Source connection config
 * @param dest - Destination connection config
 * @returns true if direct INSERT...SELECT is possible
 *
 * @example
 * ```typescript
 * const sameServer = isSameServer(sourceConfig, destConfig);
 * if (sameServer) {
 *     // Use direct INSERT...SELECT
 * } else {
 *     // Use batch transfer with data marshalling
 * }
 * ```
 */
export function isSameServer(
    source: ConnectionConfig,
    dest: ConnectionConfig,
): boolean {

    // Different dialects = different servers
    if (source.dialect !== dest.dialect) {

        return false;

    }

    // SQLite has no server concept
    if (source.dialect === 'sqlite') {

        return false;

    }

    // PostgreSQL has no reachable source to select from — see the doc comment.
    if (source.dialect === 'postgres') {

        return false;

    }

    const srcHost = normalizeHost(source.host);
    const dstHost = normalizeHost(dest.host);

    const srcPort = source.port ?? DEFAULT_PORTS[source.dialect];
    const dstPort = dest.port ?? DEFAULT_PORTS[dest.dialect];

    // Must be same host and port
    if (srcHost !== dstHost || srcPort !== dstPort) {

        return false;

    }

    // MySQL and MSSQL support cross-database queries on same server
    return true;

}

/**
 * Get the default port for a dialect.
 *
 * @param dialect - Database dialect
 * @returns Default port number
 */
export function getDefaultPort(dialect: Dialect): number {

    return DEFAULT_PORTS[dialect];

}

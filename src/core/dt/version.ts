/**
 * Database version detection.
 *
 * Queries the database to determine its version, enabling
 * version-aware type mappings (e.g., MSSQL 2025 native JSON).
 *
 * @example
 * ```typescript
 * import { queryDatabaseVersion } from './version.js';
 *
 * const [version, err] = await queryDatabaseVersion({ db, dialect: 'postgres' });
 * // { dialect: 'postgres', major: 16, minor: 2, raw: 'PostgreSQL 16.2 on ...' }
 * ```
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type { NoormDatabase } from '../shared/tables.js';
import type { DatabaseVersion } from './types.js';

/**
 * Options for querying database version.
 */
export interface QueryVersionOptions {

    /** Kysely database instance. */
    db: Kysely<NoormDatabase>;

    /** Database dialect. */
    dialect: Dialect;

}

/**
 * Query the database to detect its version.
 *
 * Parses dialect-specific version strings into structured version info
 * for use in version-aware type mapping.
 *
 * @param options - Database connection and dialect
 * @returns Database version or error
 *
 * @example
 * ```typescript
 * const [version, err] = await queryDatabaseVersion({ db, dialect: 'mssql' });
 * if (!err && version) {
 *     console.log(version.major); // 2025
 * }
 * ```
 */
export async function queryDatabaseVersion(
    options: QueryVersionOptions,
): Promise<[DatabaseVersion | null, Error | null]> {

    const { db, dialect } = options;

    switch (dialect) {

    case 'postgres':
        return queryPostgresVersion(db);

    case 'mysql':
        return queryMysqlVersion(db);

    case 'mssql':
        return queryMssqlVersion(db);

    default:
        return [null, new Error(`Unsupported dialect for version detection: ${dialect}`)];

    }

}

/**
 * Parse PostgreSQL version from `SELECT version()`.
 *
 * Format: `"PostgreSQL 16.2 on x86_64-pc-linux-gnu, ..."`
 */
async function queryPostgresVersion(db: Kysely<NoormDatabase>): Promise<[DatabaseVersion | null, Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{ version: string }>`SELECT version() as version`.execute(db),
    );

    if (err) {

        return [null, err];

    }

    const raw = result.rows[0]?.version ?? '';
    const match = raw.match(/PostgreSQL\s+(\d+)\.(\d+)/i);

    if (!match) {

        return [null, new Error(`Cannot parse PostgreSQL version from: ${raw}`)];

    }

    return [{
        dialect: 'postgres',
        major: parseInt(match[1]!, 10),
        minor: parseInt(match[2]!, 10),
        raw,
    }, null];

}

/**
 * Parse MySQL version from `SELECT version()`.
 *
 * Format: `"8.0.35"` or `"9.0.1"`
 */
async function queryMysqlVersion(db: Kysely<NoormDatabase>): Promise<[DatabaseVersion | null, Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{ version: string }>`SELECT version() as version`.execute(db),
    );

    if (err) {

        return [null, err];

    }

    const raw = result.rows[0]?.version ?? '';
    const match = raw.match(/^(\d+)\.(\d+)/);

    if (!match) {

        return [null, new Error(`Cannot parse MySQL version from: ${raw}`)];

    }

    return [{
        dialect: 'mysql',
        major: parseInt(match[1]!, 10),
        minor: parseInt(match[2]!, 10),
        raw,
    }, null];

}

/**
 * Parse MSSQL version from SERVERPROPERTY queries.
 *
 * Uses ProductMajorVersion and ProductMinorVersion server properties.
 * Maps internal version numbers to marketing years (16 → 2022, 17 → 2025).
 */
async function queryMssqlVersion(db: Kysely<NoormDatabase>): Promise<[DatabaseVersion | null, Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{
            major: string;
            minor: string;
            full_version: string;
        }>`
            SELECT
                CAST(SERVERPROPERTY('ProductMajorVersion') AS VARCHAR(10)) as major,
                CAST(SERVERPROPERTY('ProductMinorVersion') AS VARCHAR(10)) as minor,
                CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(50)) as full_version
        `.execute(db),
    );

    if (err) {

        return [null, err];

    }

    const row = result.rows[0];

    if (!row) {

        return [null, new Error('No version info returned from MSSQL')];

    }

    const internalMajor = parseInt(row.major, 10);
    const internalMinor = parseInt(row.minor, 10);

    // Map internal version to marketing year
    const marketingYear = mssqlInternalToYear(internalMajor);

    return [{
        dialect: 'mssql',
        major: marketingYear,
        minor: internalMinor,
        raw: row.full_version,
    }, null];

}

/**
 * Map MSSQL internal major version to marketing year.
 *
 * 15 → 2019, 16 → 2022, 17 → 2025
 */
function mssqlInternalToYear(internalMajor: number): number {

    const mapping: { [key: number]: number } = {
        11: 2012,
        12: 2014,
        13: 2016,
        14: 2017,
        15: 2019,
        16: 2022,
        17: 2025,
    };

    return mapping[internalMajor] ?? internalMajor;

}

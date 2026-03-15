/**
 * Info command for project/database status.
 *
 * Surfaces noorm metadata: schema versions, install/upgrade dates,
 * connection details, identity info, and DB object counts.
 * Complements the `version` command which focuses on low-level
 * diagnostics (Node, platform, key paths).
 *
 * @example
 * ```bash
 * noorm -H info
 * noorm -H --json info
 * ```
 */
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { HeadlessCommand } from './_helpers.js';
import { outputError } from './_helpers.js';
import { getCurrentVersion } from '../../core/update/checker.js';
import { CURRENT_VERSIONS } from '../../core/version/types.js';
import { getFullVersionRecord } from '../../core/version/schema/index.js';
import { fetchOverview } from '../../core/explore/index.js';
import { loadIdentityMetadata } from '../../core/identity/storage.js';
import { getStateManager } from '../../core/state/index.js';
import { findProjectRoot } from '../../core/project.js';
import { createConnection } from '../../core/connection/index.js';
import type { NoormDatabase } from '../../core/shared/tables.js';
import type { ExploreOverview } from '../../core/explore/index.js';
import type { FullVersionRecord } from '../../core/version/schema/index.js';

// =============================================================================
// Types
// =============================================================================

interface InfoResult {
    cli_version: string;
    schema_version: number;
    state_version: number;
    settings_version: number;
    installed_at: string | null;
    upgraded_at: string | null;
    active_config: string | null;
    config_count: number;
    connection: {
        host: string | undefined;
        port: number | undefined;
        database: string;
        dialect: string;
    } | null;
    connection_error?: string;
    identity: {
        name: string;
        email: string;
        machine: string;
        registered_at: string | null;
        last_seen_at: string | null;
    } | null;
    objects: {
        tables: number;
        views: number;
        functions: number;
        procedures: number;
        types: number;
    } | null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a date for human-readable output.
 */
function formatDate(date: Date | string | null | undefined): string {

    if (!date) return '--';

    const d = date instanceof Date ? date : new Date(date);

    return d.toISOString().split('T')[0]!;

}

/**
 * Format object stats for human-readable output.
 */
function formatObjectStats(objects: InfoResult['objects']): string {

    if (!objects) return '--';

    const parts: string[] = [];

    if (objects.tables > 0) parts.push(`${objects.tables} tbls`);
    if (objects.views > 0) parts.push(`${objects.views} vws`);
    if (objects.functions > 0) parts.push(`${objects.functions} fns`);
    if (objects.procedures > 0) parts.push(`${objects.procedures} procs`);
    if (objects.types > 0) parts.push(`${objects.types} types`);

    return parts.length > 0 ? parts.join('  ') : 'empty database';

}

/**
 * Gather all info data.
 */
async function gatherInfo(): Promise<InfoResult> {

    // === Declaration block ===
    const cliVersion = getCurrentVersion();
    let activeConfigName: string | null = null;
    let configCount = 0;
    let connectionInfo: InfoResult['connection'] = null;
    let connectionError: string | undefined;
    let versionRecord: FullVersionRecord | null = null;
    let overview: ExploreOverview | null = null;
    let identityDbInfo: { registeredAt: string | null; lastSeenAt: string | null } | null = null;

    // === Validation block ===
    // Load identity metadata (local — no DB needed)
    const [identityMeta] = await attempt(() => loadIdentityMetadata());

    // Find project and load state
    const projectResult = findProjectRoot();

    if (projectResult.hasProject && projectResult.projectRoot) {

        const [manager] = await attempt(async () => {

            const mgr = getStateManager(projectResult.projectRoot!);
            await mgr.load();

            return mgr;

        });

        if (manager) {

            const configs = manager.listConfigs();
            configCount = configs.length;
            const active = manager.getActiveConfig();
            activeConfigName = active?.name ?? null;

            // === Business logic block ===
            // Try connecting to the active config's database
            if (active) {

                connectionInfo = {
                    host: active.connection.host,
                    port: active.connection.port,
                    database: active.connection.database,
                    dialect: active.connection.dialect,
                };

                const [conn, connErr] = await attempt(() =>
                    createConnection(active.connection, active.name),
                );

                if (connErr) {

                    connectionError = connErr.message;

                }
                else if (conn) {

                    const db = conn.db as Kysely<NoormDatabase>;

                    // Fetch version record and overview in parallel
                    const [results] = await attempt(() =>
                        Promise.all([
                            getFullVersionRecord(db, active.connection.dialect),
                            fetchOverview(db as Kysely<unknown>, active.connection.dialect),
                        ]),
                    );

                    if (results) {

                        versionRecord = results[0];
                        overview = results[1];

                    }

                    // Fetch identity DB info if we have a local identity
                    if (identityMeta?.identityHash) {

                        const [row] = await attempt(async () =>
                            (db as Kysely<NoormDatabase>)
                                .selectFrom('__noorm_identities__')
                                .select(['registered_at', 'last_seen_at'])
                                .where('identity_hash', '=', identityMeta.identityHash)
                                .executeTakeFirst(),
                        );

                        if (row) {

                            identityDbInfo = {
                                registeredAt: row.registered_at ? new Date(row.registered_at as unknown as string).toISOString() : null,
                                lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as unknown as string).toISOString() : null,
                            };

                        }

                    }

                    await attempt(() => conn.destroy());

                }

            }

        }

    }

    // === Commit block ===
    return {
        cli_version: cliVersion,
        schema_version: versionRecord?.noormVersion ?? CURRENT_VERSIONS.schema,
        state_version: CURRENT_VERSIONS.state,
        settings_version: CURRENT_VERSIONS.settings,
        installed_at: versionRecord?.installedAt ? new Date(versionRecord.installedAt as unknown as string).toISOString() : null,
        upgraded_at: versionRecord?.upgradedAt ? new Date(versionRecord.upgradedAt as unknown as string).toISOString() : null,
        active_config: activeConfigName,
        config_count: configCount,
        connection: connectionError ? null : connectionInfo,
        connection_error: connectionError,
        identity: identityMeta ? {
            name: identityMeta.name,
            email: identityMeta.email,
            machine: identityMeta.machine,
            registered_at: identityDbInfo?.registeredAt ?? null,
            last_seen_at: identityDbInfo?.lastSeenAt ?? null,
        } : null,
        objects: overview ? {
            tables: overview.tables,
            views: overview.views,
            functions: overview.functions,
            procedures: overview.procedures,
            types: overview.types,
        } : null,
    };

}

/**
 * Format info for human-readable output.
 */
function formatInfoOutput(info: InfoResult): string {

    const lines: string[] = [];

    // Version header
    lines.push(`noorm v${info.cli_version}`);
    lines.push(`schema: v${info.schema_version}  |  state: v${info.state_version}  |  settings: v${info.settings_version}`);
    lines.push(`installed: ${formatDate(info.installed_at)}  |  upgraded: ${formatDate(info.upgraded_at)}`);
    lines.push('');

    // Config
    if (info.active_config) {

        lines.push(`Config:     ${info.active_config} (${info.config_count} configs)`);

    }
    else {

        lines.push(`Config:     none (${info.config_count} configs)`);

    }

    // Connection
    if (info.connection) {

        const { host, port, database, dialect } = info.connection;
        const hostPort = port ? `${host}:${port}` : host;
        lines.push(`Connection: ${hostPort}/${database} (${dialect})`);

    }
    else if (info.connection_error) {

        lines.push(`Connection: Error - ${info.connection_error}`);

    }
    else {

        lines.push('Connection: --');

    }

    // Identity
    if (info.identity) {

        lines.push(`Identity:   ${info.identity.name} <${info.identity.email}>`);

    }
    else {

        lines.push('Identity:   Not configured');

    }

    lines.push('');

    // Objects
    lines.push(`Objects:    ${formatObjectStats(info.objects)}`);

    return lines.join('\n');

}

// =============================================================================
// Command
// =============================================================================

export const help = `
# INFO

Show noorm project and database status.

## Usage

    noorm info
    noorm -H --json info

## Description

Displays project metadata including:
- CLI version and internal schema versions
- Installation and upgrade timestamps
- Active configuration and connection details
- Identity information
- Database object counts (tables, views, functions, procedures, types)

For low-level diagnostics (Node.js, platform, key paths), use \`noorm version\`.

## Examples

    noorm -H info
    noorm -H --json info | jq '.objects'

## JSON Output

{
    "cli_version": "0.4.2",
    "schema_version": 1,
    "state_version": 1,
    "settings_version": 1,
    "installed_at": "2026-01-15T08:30:00.000Z",
    "upgraded_at": "2026-03-10T14:22:00.000Z",
    "active_config": "dev",
    "config_count": 2,
    "connection": {
        "host": "localhost",
        "port": 5432,
        "database": "mydb",
        "dialect": "postgresql"
    },
    "identity": {
        "name": "Your Name",
        "email": "you@example.com",
        "machine": "hostname",
        "registered_at": "2026-01-15T08:30:00.000Z",
        "last_seen_at": "2026-03-13T22:00:00.000Z"
    },
    "objects": {
        "tables": 5,
        "views": 12,
        "functions": 8,
        "procedures": 9,
        "types": 13
    }
}
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [info, err] = await attempt(() => gatherInfo());

    if (err) {

        return outputError(flags, logger, err.message);

    }

    if (flags.json) {

        logger.result(info);

    }
    else {

        process.stdout.write(formatInfoOutput(info) + '\n');

    }

    return 0;

};

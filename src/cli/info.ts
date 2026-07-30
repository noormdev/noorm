/**
 * noorm info — show project and database status.
 *
 * Surfaces noorm metadata: schema versions, install/upgrade dates,
 * connection details, identity info, and DB object counts.
 * Complements `version` which focuses on low-level diagnostics
 * (Node, platform, key paths).
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';
import type { Kysely } from 'kysely';

import { getCurrentVersion } from '../core/update/checker.js';
import { CURRENT_VERSIONS } from '../core/version/types.js';
import { getFullVersionRecord } from '../core/version/schema/index.js';
import type { FullVersionRecord } from '../core/version/schema/index.js';
import { fetchOverview } from '../core/explore/index.js';
import type { ExploreOverview } from '../core/explore/index.js';
import { loadIdentityMetadata } from '../core/identity/storage.js';
import { detectAgentHarness } from '../core/policy/harness.js';
import { getStateManager } from '../core/state/index.js';
import { findProjectRoot } from '../core/project.js';
import { createConnection } from '../core/connection/index.js';
import type { NoormDatabase } from '../core/shared/tables.js';
import { outputError, outputResult, sharedArgs } from './_utils.js';

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

    /**
     * The agent harness noorm believes is driving this session, if any.
     *
     * Reported because detection silently changes the channel an operation is
     * authorised on, and a permission denial with no visible cause is a bad
     * thing to debug. `markers` names the variables actually set, which is what
     * an operator would unset to be treated as human.
     */
    agent: {
        id: string;
        name: string;
        markers: string[];
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
 *
 * Attempts project detection, state loading, and an optional DB connection
 * in sequence. Failures are captured gracefully — a missing project or
 * offline DB still returns a partial result rather than crashing.
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
    const [identityMeta] = await attempt(() => loadIdentityMetadata());

    const harness = detectAgentHarness();

    const projectResult = findProjectRoot();

    // === Business logic block ===
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
                                registeredAt: row.registered_at
                                    ? new Date(row.registered_at as unknown as string).toISOString()
                                    : null,
                                lastSeenAt: row.last_seen_at
                                    ? new Date(row.last_seen_at as unknown as string).toISOString()
                                    : null,
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
        installed_at: versionRecord?.installedAt
            ? new Date(versionRecord.installedAt as unknown as string).toISOString()
            : null,
        upgraded_at: versionRecord?.upgradedAt
            ? new Date(versionRecord.upgradedAt as unknown as string).toISOString()
            : null,
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
        agent: harness ? {
            id: harness.id,
            name: harness.name,
            markers: harness.markers.filter((marker) => !!process.env[marker]),
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

    lines.push(`noorm v${info.cli_version}`);
    lines.push(`schema: v${info.schema_version}  |  state: v${info.state_version}  |  settings: v${info.settings_version}`);
    lines.push(`installed: ${formatDate(info.installed_at)}  |  upgraded: ${formatDate(info.upgraded_at)}`);
    lines.push('');

    if (info.active_config) {

        lines.push(`Config:     ${info.active_config} (${info.config_count} configs)`);

    }
    else {

        lines.push(`Config:     none (${info.config_count} configs)`);

    }

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

    if (info.identity) {

        lines.push(`Identity:   ${info.identity.name} <${info.identity.email}>`);

    }
    else {

        lines.push('Identity:   Not configured');

    }

    if (info.agent) {

        lines.push(`Agent:      ${info.agent.name} (${info.agent.markers.join(', ')})`);

    }
    else {

        lines.push('Agent:      none detected');

    }

    lines.push('');
    lines.push(`Objects:    ${formatObjectStats(info.objects)}`);

    return lines.join('\n');

}

// =============================================================================
// Command
// =============================================================================

const infoCommand = defineCommand({
    meta: {
        name: 'info',
        description: 'Show project and database status',
    },
    args: {
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [info, err] = await attempt(() => gatherInfo());

        if (err) {

            outputError(args, err.message);
            process.exit(1);

        }

        if (args.json) {

            outputResult(args, info, '');

        }
        else {

            process.stdout.write(formatInfoOutput(info) + '\n');

        }

        process.exit(0);

    },
});

(infoCommand as typeof infoCommand & { examples: string[] }).examples = [
    'noorm info',
    'noorm info --json',
    'noorm info --json | jq \'.objects\'',
];

export default infoCommand;

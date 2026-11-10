/** Who may create or migrate the tracking tables, and what a caller that may not is told. Every surface decides through here. */
import type { Kysely } from 'kysely';

import type { Dialect } from '../connection/types.js';
import { mayWriteTracking, type Channel, type ConfigAccess } from '../policy/index.js';
import type { NoormDatabase } from '../shared/index.js';
import { checkSchemaVersion, ensureSchemaVersion } from './schema/index.js';
import { VersionMismatchError } from './types.js';

/** The caller a tracking-table bootstrap is decided for. */
export interface TrackingCaller {
    channel: Channel;
    config: { name: string; access?: ConfigAccess };
    dryRun?: boolean;
}

/**
 * Throws when the tracking tables need a migration (the message ends with `remedy`) or are newer than this version.
 * Writes nothing. Resolves to whether the tables exist, so a reader can answer "nothing recorded" without a second probe.
 *
 * @example
 * if (!(await requireCurrentSchema(db, 'postgres', readerRemedy('pipeline history')))) return [];
 */
export async function requireCurrentSchema(db: Kysely<NoormDatabase>, dialect: Dialect, remedy: string): Promise<boolean> {

    const status = await checkSchemaVersion(db, dialect);

    if (status.isNewer) throw new VersionMismatchError('schema', status.current, status.expected);

    if (status.tablesExist && status.needsMigration) {

        throw new Error(
            `tracking tables are at schema version ${status.current} and this version needs ${status.expected}. ${remedy}`,
        );

    }

    return status.tablesExist;

}

/**
 * The remedy a read gives when it meets older tracking tables: readers never migrate.
 *
 * @example
 * await requireCurrentSchema(db, dialect, readerRemedy('lock status'));
 */
export function readerRemedy(what: string): string {

    return `Reading ${what} does not migrate them: a role that can write must run a command once first.`;

}

/**
 * Creates or migrates the tracking tables for a role that may write, outside a dry run; otherwise only checks them.
 * Resolves to whether the caller may record to them.
 *
 * @example
 * const mayRecord = await prepareTrackingSchema(db, dialect, { channel: 'user', config, dryRun: false });
 */
export async function prepareTrackingSchema(db: Kysely<NoormDatabase>, dialect: Dialect, caller: TrackingCaller): Promise<boolean> {

    const mayWrite = mayWriteTracking(caller.channel, caller.config);

    if (mayWrite && !caller.dryRun) {

        await ensureSchemaVersion(db, dialect);

        return true;

    }

    await requireCurrentSchema(db, dialect, mayWrite
        ? 'A dry run does not migrate them: run a command without --dry-run first, such as "noorm change history".'
        : `The role on config "${caller.config.name}" cannot migrate them: a role that can write must run a command once first.`);

    return false;

}

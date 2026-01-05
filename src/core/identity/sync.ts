/**
 * Identity sync with database.
 *
 * Registers the current user's identity in the database and syncs
 * known users from the database to local state.
 *
 * Called automatically when connecting to a database with noorm tables.
 */
import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { NoormDatabase } from '../shared/index.js';
import type { Config } from '../config/types.js';
import type { CryptoIdentity, KnownUser } from './types.js';
import { createConnection } from '../connection/factory.js';
import { observer } from '../observer.js';
import { tablesExist } from '../version/index.js';
import { loadExistingIdentity } from './factory.js';
import { getInitializedLogger } from '../logger/init.js';

/**
 * Result of identity sync operation.
 */
export interface IdentitySyncResult {
    /** Whether the sync was successful */
    ok: boolean;

    /** Error message if sync failed */
    error?: string;

    /** Whether the identity was newly registered (vs updated) */
    registered?: boolean;

    /** Number of known users discovered */
    knownUsersCount?: number;

    /** Known users fetched from database (caller can store if needed) */
    knownUsers?: KnownUser[];
}

/**
 * Register the current user's identity in the database.
 *
 * Upserts the identity - inserts if new, updates last_seen_at if existing.
 *
 * @example
 * ```typescript
 * const identity = await loadExistingIdentity()
 * if (identity) {
 *     await registerIdentity(db, identity)
 * }
 * ```
 */
export async function registerIdentity(
    db: Kysely<NoormDatabase>,
    identity: CryptoIdentity,
): Promise<{ ok: boolean; registered: boolean; error?: string }> {

    const [existing, selectErr] = await attempt(() =>
        db
            .selectFrom('__noorm_identities__')
            .select(['id'])
            .where('identity_hash', '=', identity.identityHash)
            .executeTakeFirst(),
    );

    if (selectErr) {

        observer.emit('error', {
            source: 'identity:register:select',
            error: selectErr,
            context: {
                identityHash: identity.identityHash,
                name: identity.name,
                email: identity.email,
            },
        });

        return { ok: false, registered: false, error: selectErr.message };

    }

    if (existing) {

        // Update last_seen_at
        const [, updateErr] = await attempt(() =>
            db
                .updateTable('__noorm_identities__')
                .set({ last_seen_at: new Date() })
                .where('identity_hash', '=', identity.identityHash)
                .execute(),
        );

        if (updateErr) {

            observer.emit('error', {
                source: 'identity:register:update',
                error: updateErr,
                context: {
                    identityHash: identity.identityHash,
                    name: identity.name,
                    email: identity.email,
                },
            });

            return { ok: false, registered: false, error: updateErr.message };

        }

        return { ok: true, registered: false };

    }

    // Insert new identity
    const [, insertErr] = await attempt(() =>
        db
            .insertInto('__noorm_identities__')
            .values({
                identity_hash: identity.identityHash,
                email: identity.email,
                name: identity.name,
                machine: identity.machine,
                os: identity.os,
                public_key: identity.publicKey,
            })
            .execute(),
    );

    if (insertErr) {

        observer.emit('error', {
            source: 'identity:register:insert',
            error: insertErr,
            context: {
                identityHash: identity.identityHash,
                name: identity.name,
                email: identity.email,
            },
        });

        return { ok: false, registered: false, error: insertErr.message };

    }

    observer.emit('identity:registered', {
        identityHash: identity.identityHash,
        name: identity.name,
        email: identity.email,
    });

    return { ok: true, registered: true };

}

/**
 * Fetch all known users from the database.
 *
 * Converts database rows to KnownUser objects for local caching.
 *
 * @example
 * ```typescript
 * const { users } = await fetchKnownUsers(db, 'my-config')
 * await stateManager.addKnownUsers(users)
 * ```
 */
export async function fetchKnownUsers(
    db: Kysely<NoormDatabase>,
    configName: string,
): Promise<{ ok: boolean; users: KnownUser[]; error?: string }> {

    const [rows, err] = await attempt(() =>
        db
            .selectFrom('__noorm_identities__')
            .selectAll()
            .execute(),
    );

    if (err) {

        return { ok: false, users: [], error: err.message };

    }

    const users: KnownUser[] = (rows ?? []).map((row) => ({
        identityHash: row.identity_hash,
        email: row.email,
        name: row.name,
        publicKey: row.public_key,
        machine: row.machine,
        os: row.os,
        lastSeen: row.last_seen_at instanceof Date
            ? row.last_seen_at.toISOString()
            : String(row.last_seen_at),
        source: configName,
    }));

    return { ok: true, users };

}

/**
 * Sync identity with database.
 *
 * Performs two operations:
 * 1. Registers the current user's identity in the database
 * 2. Fetches all known users from the database
 *
 * Skips sync if:
 * - No identity is provided
 * - Database doesn't have noorm tracking tables
 *
 * @example
 * ```typescript
 * const conn = await createConnection(config.connection, config.name)
 * const identity = await loadExistingIdentity()
 *
 * const result = await syncIdentity(conn.db, identity, config.name)
 * if (result.ok && result.knownUsersCount) {
 *     // Fetch known users from database
 *     const { users } = await fetchKnownUsers(conn.db, config.name)
 *     // Store in local state for caching
 *     await stateManager.addKnownUsers(users)
 * }
 * ```
 */
export async function syncIdentity(
    db: Kysely<NoormDatabase>,
    identity: CryptoIdentity | null,
    configName: string,
): Promise<IdentitySyncResult> {

    // Check if tracking tables exist
    const [hasTracking, checkErr] = await attempt(() => tablesExist(db));

    if (checkErr) {

        return { ok: false, error: checkErr.message };

    }

    if (!hasTracking) {

        // Database doesn't have noorm tables yet - skip sync
        return { ok: true, knownUsersCount: 0 };

    }

    // Register current identity if available
    let registered = false;

    if (identity) {

        const regResult = await registerIdentity(db, identity);

        if (!regResult.ok) {

            return { ok: false, error: regResult.error };

        }

        registered = regResult.registered;

    }

    // Fetch known users count
    const [count, countErr] = await attempt(() =>
        db
            .selectFrom('__noorm_identities__')
            .select(db.fn.count<number>('id').as('count'))
            .executeTakeFirst(),
    );

    if (countErr) {

        return { ok: false, error: countErr.message };

    }

    const knownUsersCount = Number(count?.count ?? 0);

    observer.emit('identity:synced', {
        configName,
        registered,
        knownUsersCount,
    });

    return { ok: true, registered, knownUsersCount };

}

/**
 * High-level identity sync with a config.
 *
 * Handles the complete flow:
 * 1. Creates a database connection
 * 2. Registers the current user's identity
 * 3. Fetches known users from the database
 * 4. Returns known users for caller to store
 * 5. Closes the connection
 *
 * Silently skips if:
 * - No identity is set up
 * - Database doesn't have noorm tables
 * - Connection fails (non-blocking)
 *
 * @example
 * ```typescript
 * // After activating a config
 * const result = await syncIdentityWithConfig(config);
 * if (result.ok && result.knownUsers?.length) {
 *     await stateManager.addKnownUsers(result.knownUsers);
 * }
 * ```
 */
export async function syncIdentityWithConfig(
    config: Config,
): Promise<IdentitySyncResult> {

    // Load identity from global ~/.noorm/identity.json
    const [identity] = await attempt(() => loadExistingIdentity());

    getInitializedLogger()?.info('Loaded existing identity', { identity });

    // Skip if no identity set up
    if (!identity) {

        return { ok: true, knownUsersCount: 0 };

    }

    // Try to connect
    const [conn, connErr] = await attempt(() =>
        createConnection(config.connection, config.name),
    );

    if (connErr) {

        observer.emit('error', {
            source: 'identity:sync:connection',
            error: connErr,
            context: {
                configName: config.name,
            },
        });

        // Connection failed - non-blocking, just skip sync
        return { ok: true, knownUsersCount: 0 };

    }


    const db = conn!.db as Kysely<NoormDatabase>;

    // Sync identity
    const syncResult = await syncIdentity(db, identity, config.name);

    if (!syncResult.ok) {

        return syncResult;

    }

    // Fetch known users if there are any
    if (syncResult.knownUsersCount && syncResult.knownUsersCount > 0) {

        const [res, err] = await attempt(() => fetchKnownUsers(db, config.name));

        if (err) {

            observer.emit('error', {
                source: 'identity:fetch-known-users',
                error: err,
                context: {
                    configName: config.name,
                },
            });

            return { ok: false, error: err.message };

        }

        const { ok, users, error } = res;

        if (!ok) {

            return { ok: false, error };

        }

        return {
            ...syncResult,
            knownUsers: users,
        };

    }

    return syncResult;

}

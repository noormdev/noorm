/**
 * Integration tests for DbNamespace.reset() vs teardown.preserveTables.
 *
 * reset() is a full rebuild (teardown + forced build from sql/). It must
 * NOT honor `settings.teardown.preserveTables`: any table left standing
 * would collide with the build's CREATE TABLE and abort the rebuild
 * (regression — the llm-memory-db-mssql example hit this, because its
 * reference vocabulary tables are in preserveTables for the per-test
 * truncate workflow). Standalone teardown() must still preserve them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'kysely';

import { DbNamespace } from '../../../src/sdk/namespaces/db.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';

import type { ContextState } from '../../../src/sdk/state.js';
import type { ConnectionResult } from '../../../src/core/connection/index.js';

describe('integration: sdk DbNamespace reset vs preserveTables', () => {

    let conn: ConnectionResult;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');
        conn = await createTestConnection('postgres');

    });

    afterAll(async () => {

        if (conn) {

            await sql.raw('DROP TABLE IF EXISTS ev_keep CASCADE').execute(conn.db).catch(() => {});
            await sql.raw('DROP TABLE IF EXISTS ev_drop CASCADE').execute(conn.db).catch(() => {});
            await conn.destroy();

        }

    });

    function makeState(): ContextState {

        return {
            connection: conn,
            config: {
                name: 'test',
                type: 'local',
                isTest: true,
                access: { user: 'admin', mcp: 'admin' },
                connection: { dialect: 'postgres', database: 'noorm_test' },
            },
            settings: { teardown: { preserveTables: ['ev_keep'] } },
            identity: { name: 'tester', source: 'system' },
            // `db:teardown` and `db:reset` are confirm cells even for admin, and
            // the SDK has no interactive prompt — `yes` is the programmatic
            // equivalent of `--yes`. Without it these destructive calls are
            // refused, which is the intended behaviour, not a test concern.
            options: { yes: true },
            projectRoot: '/tmp',
            changeManager: null,
        };

    }

    async function createMarkers(): Promise<void> {

        await sql.raw('DROP TABLE IF EXISTS ev_keep CASCADE').execute(conn.db);
        await sql.raw('DROP TABLE IF EXISTS ev_drop CASCADE').execute(conn.db);
        await sql.raw('CREATE TABLE ev_keep (id int)').execute(conn.db);
        await sql.raw('CREATE TABLE ev_drop (id int)').execute(conn.db);

    }

    async function exists(table: string): Promise<boolean> {

        const r = await sql<{ n: number }>`
            SELECT COUNT(*)::int AS n FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ${table}
        `.execute(conn.db);

        return (r.rows[0]?.n ?? 0) > 0;

    }

    it('teardown() honors settings.teardown.preserveTables', async () => {

        await createMarkers();

        const db = new DbNamespace(makeState());
        await db.teardown();

        expect(await exists('ev_keep')).toBe(true);
        expect(await exists('ev_drop')).toBe(false);

    });

    it('reset() ignores preserveTables and drops everything before rebuilding', async () => {

        await createMarkers();

        let buildForced: boolean | undefined;
        const db = new DbNamespace(makeState(), async (opts?: { force?: boolean }) => {

            buildForced = opts?.force;

        });

        await db.reset();

        // The build runs (forced) on a fully cleared schema — no collision.
        expect(buildForced).toBe(true);
        expect(await exists('ev_keep')).toBe(false);
        expect(await exists('ev_drop')).toBe(false);

    });

});

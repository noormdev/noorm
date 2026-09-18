/**
 * Integration test: MSSQL logins that hold no server-level privileges.
 *
 * A contained database user (the norm on Azure SQL Database) cannot log in to
 * `master`, and a login without `VIEW ANY DATABASE` cannot see other rows in
 * `sys.databases`; connecting must need neither. Passwords carry special
 * characters so a password bug and a privilege bug stay distinguishable.
 *
 * Requires the docker-compose.test.yml MSSQL container on port 11433, and
 * fails with a clear message when it is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createMssqlConnection } from '../../../src/core/connection/dialects/mssql.js';
import { testConnection } from '../../../src/core/connection/factory.js';
import type { ConnectionConfig, ConnectionResult } from '../../../src/core/connection/types.js';

import { TEST_CONNECTIONS, createTestConnection, skipIfNoContainer } from '../../utils/db.js';


const CONTAINED_DB = 'noorm_test_login_contained';
const PLAIN_DB = 'noorm_test_login_plain';
const CONTAINED_USER = { user: 'noorm_contained_user', password: 'C0nt@ined!#$;pw' };
const NO_VIEW_LOGIN = { user: 'noorm_no_view_any', password: 'N0V!ew#$;pw' };

function connectionTo(database: string): ConnectionConfig {

    return { ...TEST_CONNECTIONS.mssql, database };

}

async function whoAmI(config: ConnectionConfig): Promise<string> {

    const conn = await createMssqlConnection(config);

    const [rows, err] = await attempt(async () => {

        const result = await sql<{ who: string }>`SELECT USER_NAME() AS who`.execute(conn.db);

        return result.rows;

    });

    await conn.destroy();

    if (err) {

        throw err;

    }

    return rows![0]!.who;

}


describe('connection/dialects/mssql: logins without server-level privileges', () => {

    let sa: ConnectionResult;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        sa = await createTestConnection('mssql');

        const exec = (statement: string) => sql.raw(statement).execute(sa.db);

        await exec('EXEC sp_configure \'contained database authentication\', 1; RECONFIGURE;');

        await exec(`IF DB_ID('${CONTAINED_DB}') IS NULL CREATE DATABASE ${CONTAINED_DB};`);
        await exec(`ALTER DATABASE ${CONTAINED_DB} SET CONTAINMENT = PARTIAL;`);
        await exec(`IF DB_ID('${PLAIN_DB}') IS NULL CREATE DATABASE ${PLAIN_DB};`);

        await exec(`
            IF SUSER_ID('${NO_VIEW_LOGIN.user}') IS NULL
                CREATE LOGIN ${NO_VIEW_LOGIN.user} WITH PASSWORD = '${NO_VIEW_LOGIN.password}', CHECK_POLICY = OFF;
        `);

        // These statements only run from inside the database they act on, and
        // this pool is pinned to the test database.
        await exec(`EXEC('USE master; DENY VIEW ANY DATABASE TO ${NO_VIEW_LOGIN.user};')`);

        await exec(`EXEC('USE ${CONTAINED_DB};
            IF USER_ID(''${CONTAINED_USER.user}'') IS NULL
                CREATE USER ${CONTAINED_USER.user} WITH PASSWORD = ''${CONTAINED_USER.password}'';')`);

        await exec(`EXEC('USE ${PLAIN_DB};
            IF USER_ID(''${NO_VIEW_LOGIN.user}'') IS NULL
                CREATE USER ${NO_VIEW_LOGIN.user} FOR LOGIN ${NO_VIEW_LOGIN.user};')`);

    });

    afterAll(async () => {

        if (!sa) return;

        const exec = (statement: string) => sql.raw(statement).execute(sa.db);

        await attempt(() => exec(`
            IF DB_ID('${CONTAINED_DB}') IS NOT NULL
            BEGIN
                ALTER DATABASE ${CONTAINED_DB} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE ${CONTAINED_DB};
            END
            IF DB_ID('${PLAIN_DB}') IS NOT NULL
            BEGIN
                ALTER DATABASE ${PLAIN_DB} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE ${PLAIN_DB};
            END
            IF SUSER_ID('${NO_VIEW_LOGIN.user}') IS NOT NULL DROP LOGIN ${NO_VIEW_LOGIN.user};
        `));

        await sa.destroy();

    });

    it('should connect as a contained database user, who cannot log in to master', async () => {

        const who = await whoAmI({ ...connectionTo(CONTAINED_DB), ...CONTAINED_USER });

        expect(who).toBe(CONTAINED_USER.user);

    });

    it('should connect as a login that cannot see other databases', async () => {

        const who = await whoAmI({ ...connectionTo(PLAIN_DB), ...NO_VIEW_LOGIN });

        expect(who).toBe(NO_VIEW_LOGIN.user);

    });

    it('should name the database, not the password, when the target does not exist', async () => {

        const [result, err] = await attempt(() => createMssqlConnection(connectionTo('noorm_test_login_missing')));

        expect(result).toBeNull();
        expect(err?.message).toContain('\'noorm_test_login_missing\'');
        expect(err?.message).toContain('does not exist');

    });

    // The config add/edit screens run this check before saving, so failing it
    // leaves a contained user with no way to store a config at all.
    it('should pass the server-only connection test as a contained database user', async () => {

        const result = await testConnection({ ...connectionTo(CONTAINED_DB), ...CONTAINED_USER }, { testServerOnly: true });

        expect(result).toEqual({ ok: true });

    });

    it('should pass the server-only connection test before the target database exists', async () => {

        const result = await testConnection(connectionTo('noorm_test_login_missing'), { testServerOnly: true });

        expect(result).toEqual({ ok: true });

    });

});

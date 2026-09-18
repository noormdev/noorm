/**
 * Integration test: a failed connection says why it failed.
 *
 * Every case is produced against the docker-compose.test.yml containers
 * rather than faked, because the error shapes are the drivers' and change
 * with them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createConnection, testConnection } from '../../../src/core/connection/factory.js';
import type { ConnectionConfig, ConnectionResult } from '../../../src/core/connection/types.js';
import { observer } from '../../../src/core/observer.js';
import type { NoormEvents } from '../../../src/core/observer.js';

import { TEST_CONNECTIONS, assertTestDatabase, createTestConnection, skipIfNoContainer } from '../../utils/db.js';


const LOGIN = 'noorm_err_login';
const PASSWORD = 'Err!#$;pw1';

/**
 * Nothing listens on port 1 on a developer machine or a CI runner, so the
 * connection is refused rather than left to time out.
 */
const CLOSED_PORT = 1;

/** RFC 2606 reserves `.invalid`, so this name never resolves. */
const UNKNOWN_HOST = 'noorm-no-such-host.invalid';

/** A database the test login exists for but may not use. */
const NO_ACCESS_DB = 'noorm_test_err_no_access';

async function connectionError(config: ConnectionConfig): Promise<string> {

    const result = await testConnection(config);

    expect(result.ok).toBe(false);

    return result.error ?? '';

}

/**
 * The `connection:error` event a failed connection emits, which is what the
 * log file records.
 */
async function loggedFailure(config: ConnectionConfig): Promise<NoormEvents['connection:error']> {

    const events: NoormEvents['connection:error'][] = [];
    const stop = observer.on('connection:error', (data) => {

        events.push(data);

    });

    await testConnection(config);
    stop();

    expect(events.length).toBeGreaterThan(0);

    return events.at(-1)!;

}

/**
 * Open an admin connection that still passes the test-database guard, for the
 * dialects whose test user cannot create accounts.
 */
async function adminConnection(config: ConnectionConfig): Promise<ConnectionResult> {

    assertTestDatabase(config);

    return createConnection(config, '__test_admin__');

}


describe('connection: errors name their reason on mssql', () => {

    const base = { ...TEST_CONNECTIONS.mssql };
    let admin: ConnectionResult;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        admin = await createTestConnection('mssql');

        await sql.raw(`
            IF SUSER_ID('${LOGIN}') IS NULL
                CREATE LOGIN ${LOGIN} WITH PASSWORD = '${PASSWORD}', CHECK_POLICY = OFF;
            IF SUSER_ID('${LOGIN}_disabled') IS NULL
                CREATE LOGIN ${LOGIN}_disabled WITH PASSWORD = '${PASSWORD}', CHECK_POLICY = OFF;
            ALTER LOGIN ${LOGIN}_disabled DISABLE;
            IF SUSER_ID('${LOGIN}_expired') IS NULL
                CREATE LOGIN ${LOGIN}_expired WITH PASSWORD = '${PASSWORD}Long' MUST_CHANGE,
                    CHECK_EXPIRATION = ON, CHECK_POLICY = ON;
            IF USER_ID('${LOGIN}') IS NULL CREATE USER ${LOGIN} FOR LOGIN ${LOGIN};
            IF USER_ID('${LOGIN}_disabled') IS NULL CREATE USER ${LOGIN}_disabled FOR LOGIN ${LOGIN}_disabled;
            IF USER_ID('${LOGIN}_expired') IS NULL CREATE USER ${LOGIN}_expired FOR LOGIN ${LOGIN}_expired;
        `).execute(admin.db);

    }, 30_000);

    afterAll(async () => {

        if (!admin) return;

        await attempt(() => sql.raw(`
            IF USER_ID('${LOGIN}') IS NOT NULL DROP USER ${LOGIN};
            IF USER_ID('${LOGIN}_disabled') IS NOT NULL DROP USER ${LOGIN}_disabled;
            IF USER_ID('${LOGIN}_expired') IS NOT NULL DROP USER ${LOGIN}_expired;
            IF SUSER_ID('${LOGIN}') IS NOT NULL DROP LOGIN ${LOGIN};
            IF SUSER_ID('${LOGIN}_disabled') IS NOT NULL DROP LOGIN ${LOGIN}_disabled;
            IF SUSER_ID('${LOGIN}_expired') IS NOT NULL DROP LOGIN ${LOGIN}_expired;
        `).execute(admin.db));

        await admin.destroy();

    });

    it('should connect with the right password, so the failures below are about the cases', async () => {

        expect(await testConnection({ ...base, user: LOGIN, password: PASSWORD })).toEqual({ ok: true });

    });

    it('should say SQL Server withholds the reason for a rejected login, and list what it could be', async () => {

        const error = await connectionError({ ...base, user: LOGIN, password: 'wrong' });

        expect(error).toContain(`Login failed for user '${LOGIN}'`);
        expect(error).toContain('wrong password');
        expect(error).toContain('error log');
        // The TUI offers to create the database when it reads this phrase.
        expect(error).not.toContain('does not exist');

    });

    it('should log SQL Server\'s own error number and message next to the reworded one', async () => {

        const logged = await loggedFailure({ ...base, user: LOGIN, password: 'wrong' });

        expect(logged.serverCode).toBe('18456');
        expect(logged.serverMessage).toContain(`Login failed for user '${LOGIN}'.`);

    });

    it('should name a disabled login and how to enable it', async () => {

        const error = await connectionError({ ...base, user: `${LOGIN}_disabled`, password: PASSWORD });

        expect(error).toContain(`Login '${LOGIN}_disabled' is disabled`);
        expect(error).toContain('ALTER LOGIN');

    });

    it('should name a password that must be changed before login', async () => {

        const error = await connectionError({ ...base, user: `${LOGIN}_expired`, password: `${PASSWORD}Long` });

        expect(error).toContain(`The password for login '${LOGIN}_expired' must be changed`);

    });

    it('should log the socket error that tedious reports as "Could not connect (sequence)"', async () => {

        const logged = await loggedFailure({ ...base, host: 'localhost', port: CLOSED_PORT });

        expect(logged.serverCode).toContain('ECONNREFUSED');
        expect(logged.serverMessage).toContain('Could not connect (sequence)');
        expect(logged.serverMessage).toContain('ECONNREFUSED');

    });

    it('should name a refused port instead of tedious\'s "Could not connect (sequence)"', async () => {

        const error = await connectionError({ ...base, host: 'localhost', port: CLOSED_PORT });

        expect(error).toContain(`Connection refused at localhost:${CLOSED_PORT}`);

    });

    it('should name a host that does not resolve', async () => {

        const error = await connectionError({ ...base, host: UNKNOWN_HOST });

        expect(error).toContain(`Host '${UNKNOWN_HOST}' could not be found`);

    });

    it('should name a rejected TLS certificate and keep encryption available without validation', async () => {

        const error = await connectionError({ ...base, host: 'localhost', ssl: true });

        expect(error).toContain('TLS certificate was rejected');
        expect(error).toContain('DEPTH_ZERO_SELF_SIGNED_CERT');

    });

});


describe('connection: errors name their reason on postgres', () => {

    const base = { ...TEST_CONNECTIONS.postgres };
    let admin: ConnectionResult;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        admin = await createTestConnection('postgres');

        await sql.raw(`DROP DATABASE IF EXISTS ${NO_ACCESS_DB}`).execute(admin.db);
        await sql.raw(`DROP ROLE IF EXISTS ${LOGIN}, ${LOGIN}_limit, ${LOGIN}_nologin`).execute(admin.db);
        await sql.raw(`CREATE ROLE ${LOGIN} LOGIN PASSWORD '${PASSWORD}'`).execute(admin.db);
        await sql.raw(`CREATE ROLE ${LOGIN}_limit LOGIN PASSWORD '${PASSWORD}' CONNECTION LIMIT 0`).execute(admin.db);
        await sql.raw(`CREATE ROLE ${LOGIN}_nologin NOLOGIN PASSWORD '${PASSWORD}'`).execute(admin.db);
        await sql.raw(`CREATE DATABASE ${NO_ACCESS_DB}`).execute(admin.db);
        await sql.raw(`REVOKE CONNECT ON DATABASE ${NO_ACCESS_DB} FROM PUBLIC`).execute(admin.db);

    }, 30_000);

    afterAll(async () => {

        if (!admin) return;

        await attempt(() => sql.raw(`DROP DATABASE IF EXISTS ${NO_ACCESS_DB}`).execute(admin.db));
        await attempt(() => sql.raw(`DROP ROLE IF EXISTS ${LOGIN}, ${LOGIN}_limit, ${LOGIN}_nologin`).execute(admin.db));
        await admin.destroy();

    });

    it('should connect with the right password, so the failures below are about the cases', async () => {

        expect(await testConnection({ ...base, user: LOGIN, password: PASSWORD })).toEqual({ ok: true });

    });

    it('should say PostgreSQL withholds the reason for a rejected password, and list what it could be', async () => {

        const error = await connectionError({ ...base, user: LOGIN, password: 'wrong' });

        expect(error).toContain(`Password authentication failed for user '${LOGIN}'`);
        expect(error).toContain('expired password');
        expect(error).not.toContain('does not exist');

    });

    it('should log PostgreSQL\'s SQLSTATE and message next to the reworded one', async () => {

        const logged = await loggedFailure({ ...base, user: LOGIN, password: 'wrong' });

        expect(logged.serverCode).toBe('28P01');
        expect(logged.serverMessage).toContain(`password authentication failed for user "${LOGIN}"`);

    });

    it('should name a role that may not log in', async () => {

        const error = await connectionError({ ...base, user: `${LOGIN}_nologin`, password: PASSWORD });

        expect(error).toContain(`Role '${LOGIN}_nologin' is not allowed to log in (NOLOGIN)`);

    });

    it('should name a missing CONNECT privilege', async () => {

        const error = await connectionError({ ...base, database: NO_ACCESS_DB, user: LOGIN, password: PASSWORD });

        expect(error).toContain(`Role '${LOGIN}' may not connect to database '${NO_ACCESS_DB}'`);

    });

    // "too many connections" is retried with backoff, which alone takes ~6s.
    it('should surface the server\'s error when retries run out, not "Max retries reached"', async () => {

        const logged = await loggedFailure({ ...base, user: `${LOGIN}_limit`, password: PASSWORD });

        expect(logged.error).toContain(`Role '${LOGIN}_limit' has used up its connection limit`);
        expect(logged.serverMessage).toContain('too many connections for role');
        expect(logged.error).not.toContain('Max retries reached');

    }, 30_000);

    it('should name a refused port instead of an empty message', async () => {

        const error = await connectionError({ ...base, host: 'localhost', port: CLOSED_PORT });

        expect(error).toContain(`Connection refused at localhost:${CLOSED_PORT}`);

    });

    it('should name a host that does not resolve', async () => {

        const error = await connectionError({ ...base, host: UNKNOWN_HOST });

        expect(error).toContain(`Host '${UNKNOWN_HOST}' could not be found`);

    });

});


describe('connection: errors name their reason on mysql', () => {

    // The test user cannot create accounts; root can, and the database name
    // still passes the test-database guard.
    const base = { ...TEST_CONNECTIONS.mysql };
    const root = { ...base, user: 'root', password: 'noorm_test' };
    let admin: ConnectionResult;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        admin = await adminConnection(root);

        await sql.raw(`DROP USER IF EXISTS '${LOGIN}'@'%', '${LOGIN}_locked'@'%', '${LOGIN}_expired'@'%'`).execute(admin.db);
        await sql.raw(`CREATE USER '${LOGIN}'@'%' IDENTIFIED BY '${PASSWORD}'`).execute(admin.db);
        await sql.raw(`GRANT ALL ON ${base.database}.* TO '${LOGIN}'@'%'`).execute(admin.db);
        await sql.raw(`CREATE USER '${LOGIN}_locked'@'%' IDENTIFIED BY '${PASSWORD}' ACCOUNT LOCK`).execute(admin.db);
        await sql.raw(`CREATE USER '${LOGIN}_expired'@'%' IDENTIFIED BY '${PASSWORD}' PASSWORD EXPIRE`).execute(admin.db);
        await sql.raw(`GRANT ALL ON ${base.database}.* TO '${LOGIN}_expired'@'%'`).execute(admin.db);
        await sql.raw(`CREATE DATABASE IF NOT EXISTS ${NO_ACCESS_DB}`).execute(admin.db);

    }, 30_000);

    afterAll(async () => {

        if (!admin) return;

        await attempt(() => sql.raw(`DROP DATABASE IF EXISTS ${NO_ACCESS_DB}`).execute(admin.db));
        await attempt(() => sql.raw(
            `DROP USER IF EXISTS '${LOGIN}'@'%', '${LOGIN}_locked'@'%', '${LOGIN}_expired'@'%'`,
        ).execute(admin.db));
        await admin.destroy();

    });

    it('should connect with the right password, so the failures below are about the cases', async () => {

        expect(await testConnection({ ...base, user: LOGIN, password: PASSWORD })).toEqual({ ok: true });

    });

    it('should say MySQL withholds the reason for a denied login, and list what it could be', async () => {

        const error = await connectionError({ ...base, user: LOGIN, password: 'wrong' });

        expect(error).toContain(`Access denied for user '${LOGIN}'`);
        expect(error).toContain('REQUIRE SSL');
        expect(error).not.toContain('does not exist');

    });

    it('should log MySQL\'s error code and message, which names the client host', async () => {

        const logged = await loggedFailure({ ...base, user: LOGIN, password: 'wrong' });

        expect(logged.serverCode).toBe('ER_ACCESS_DENIED_ERROR');
        expect(logged.serverMessage).toContain(`Access denied for user '${LOGIN}'@`);

    });

    it('should name a locked account', async () => {

        const error = await connectionError({ ...base, user: `${LOGIN}_locked`, password: PASSWORD });

        expect(error).toContain(`Account '${LOGIN}_locked' is locked`);

    });

    it('should name an expired password', async () => {

        const error = await connectionError({ ...base, user: `${LOGIN}_expired`, password: PASSWORD });

        expect(error).toContain(`The password for '${LOGIN}_expired' has expired`);

    });

    it('should name a database the user holds no privileges on', async () => {

        const error = await connectionError({ ...base, database: NO_ACCESS_DB, user: LOGIN, password: PASSWORD });

        expect(error).toContain(`User '${LOGIN}' has no privileges on database '${NO_ACCESS_DB}'`);

    });

    it('should name a missing password', async () => {

        const error = await connectionError({ ...base, user: LOGIN, password: undefined });

        expect(error).toContain(`No password was supplied for user '${LOGIN}'`);

    });

    it('should name a refused port instead of an empty message', async () => {

        const error = await connectionError({ ...base, host: 'localhost', port: CLOSED_PORT });

        expect(error).toContain(`Connection refused at localhost:${CLOSED_PORT}`);

    });

});


describe('connection: errors name their reason on sqlite', () => {

    let dir: string;

    beforeAll(() => {

        dir = mkdtempSync(join(tmpdir(), 'noorm-test-sqlite-errors-'));

        writeFileSync(join(dir, 'junk.db'), 'not a sqlite database '.repeat(40));
        writeFileSync(join(dir, 'locked.db'), '');
        chmodSync(join(dir, 'locked.db'), 0o000);
        mkdirSync(join(dir, 'readonly'));
        chmodSync(join(dir, 'readonly'), 0o555);

    });

    afterAll(() => {

        chmodSync(join(dir, 'locked.db'), 0o644);
        chmodSync(join(dir, 'readonly'), 0o755);
        rmSync(dir, { recursive: true, force: true });

    });

    it('should name a missing directory', async () => {

        const error = await connectionError({ dialect: 'sqlite', database: join(dir, 'nope', 'app.db') });

        expect(error).toContain(`directory '${join(dir, 'nope')}' is missing`);
        expect(error).not.toContain('does not exist');

    });

    it('should name a file this process may not read or write', async () => {

        const error = await connectionError({ dialect: 'sqlite', database: join(dir, 'locked.db') });

        expect(error).toContain('lacks read or write permission');

    });

    it('should name a directory a new database file cannot be created in', async () => {

        const error = await connectionError({ dialect: 'sqlite', database: join(dir, 'readonly', 'app.db') });

        expect(error).toContain(`lacks write permission on '${join(dir, 'readonly')}'`);

    });

    it('should name a file that is not a SQLite database', async () => {

        const error = await connectionError({ dialect: 'sqlite', database: join(dir, 'junk.db') });

        expect(error).toContain('is not a SQLite database');

    });

});


// Last in the file on purpose. pg raises this error on the client side and
// leaves the socket open, so PostgreSQL keeps that backend in authentication
// until authentication_timeout (60s by default), and DROP DATABASE waits for
// it. Run earlier, it stalls the postgres suite's cleanup for most of a minute.
describe('connection: a missing postgres password is named', () => {

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

    });

    it('should name a missing password instead of the SCRAM client message', async () => {

        // An unknown role gets the same SCRAM challenge, so no role is needed.
        const error = await connectionError({ ...TEST_CONNECTIONS.postgres, user: `${LOGIN}_nopass`, password: '' });

        expect(error).toContain(`No password was supplied for user '${LOGIN}_nopass'`);
        expect(error).not.toContain('SCRAM');

    });

});

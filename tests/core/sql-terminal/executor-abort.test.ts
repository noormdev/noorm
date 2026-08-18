/**
 * SQL executor cancellation tests.
 *
 * The intent being pinned is honesty about what a cancel achieved. Stopping
 * the client is always possible; stopping the server is not, and the result
 * has to say which of the two happened so the UI cannot overclaim.
 *
 * Whether the server really stops is proved against live databases in
 * `tests/integration/sql-terminal/cancel.test.ts` — it cannot be proved here.
 */
import { describe, it, expect } from 'bun:test';
import { sql } from 'kysely';

import { createConnection } from '../../../src/core/connection/index.js';
import {
    abortMessageFor,
    executeRawSql,
    executeRawSqlUnchecked,
    hasServerSideCancel,
    readSessionId,
} from '../../../src/core/sql-terminal/executor.js';
import { DEFAULT_ACCESS } from '../../../src/core/policy/index.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';

async function sqliteConnection(): Promise<ConnectionResult> {

    return createConnection({ dialect: 'sqlite', database: ':memory:' });

}

describe('sql-terminal: hasServerSideCancel', () => {

    it('should claim server-side cancellation only where a cancel is actually sent', () => {

        expect(hasServerSideCancel('postgres')).toBe(true);
        expect(hasServerSideCancel('mysql')).toBe(true);

    });

    it('should not claim it for dialects where the client only stops listening', () => {

        expect(hasServerSideCancel('mssql')).toBe(false);
        expect(hasServerSideCancel('sqlite')).toBe(false);

    });

});

describe('sql-terminal: abortMessageFor', () => {

    it('should say the server was asked to stop, where a cancel is genuinely sent', () => {

        expect(abortMessageFor('postgres')).toContain('server was asked to stop');
        expect(abortMessageFor('mysql')).toContain('server was asked to stop');

    });

    it('should say only that the client stopped waiting, everywhere else', () => {

        expect(abortMessageFor('mssql')).toContain('may still be running');
        expect(abortMessageFor('sqlite')).toContain('may still be running');

    });

});

describe('sql-terminal: readSessionId', () => {

    it('should read a numeric session id', () => {

        expect(readSessionId([{ id: 4711 }])).toBe(4711);

    });

    it('should read a numeric string, which is how some drivers return a bigint', () => {

        expect(readSessionId([{ id: '4711' }])).toBe(4711);

    });

    it('should reject anything that is not a positive integer', () => {

        // The id is interpolated into `KILL QUERY`, which cannot be prepared.
        // This guard is the only thing between a surprising driver value and
        // that string.
        expect(readSessionId([{ id: '4711; drop table users' }])).toBeUndefined();
        expect(readSessionId([{ id: 'pid' }])).toBeUndefined();
        expect(readSessionId([{ id: 12.5 }])).toBeUndefined();
        expect(readSessionId([{ id: 0 }])).toBeUndefined();
        expect(readSessionId([{ id: -1 }])).toBeUndefined();
        expect(readSessionId([{ id: null }])).toBeUndefined();

    });

    it('should reject an empty probe result rather than guessing', () => {

        expect(readSessionId([])).toBeUndefined();
        expect(readSessionId([{}])).toBeUndefined();

    });

});

describe('sql-terminal: executor cancellation', () => {

    it('should behave exactly as before when no signal is passed', async () => {

        const conn = await sqliteConnection();

        const result = await executeRawSqlUnchecked(conn.db, 'SELECT 1 AS n', 'test');

        expect(result.success).toBe(true);
        expect(result.rows).toEqual([{ n: 1 }]);
        expect(result.aborted).toBeUndefined();

        await conn.destroy();

    });

    it('should ignore a signal that never fires', async () => {

        const conn = await sqliteConnection();
        const controller = new AbortController();

        const result = await executeRawSqlUnchecked(conn.db, 'SELECT 1 AS n', 'test', {
            signal: controller.signal,
            dialect: 'sqlite',
        });

        expect(result.success).toBe(true);
        expect(result.aborted).toBeUndefined();

        await conn.destroy();

    });

    it('should report stopped-waiting for a dialect with no cancel to send', async () => {

        const conn = await sqliteConnection();
        const controller = new AbortController();
        controller.abort();

        const result = await executeRawSqlUnchecked(conn.db, 'SELECT 1 AS n', 'test', {
            signal: controller.signal,
            dialect: 'sqlite',
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBe('stopped-waiting');
        expect(result.errorMessage).toContain('still be running');

        await conn.destroy();

    });

    it('should thread the signal through the policy-gated entry point', async () => {

        const conn = await sqliteConnection();
        const controller = new AbortController();
        controller.abort();

        const result = await executeRawSql(
            conn.db,
            'SELECT 1 AS n',
            'test',
            { access: DEFAULT_ACCESS, channel: 'user', dialect: 'sqlite' },
            controller.signal,
        );

        expect(result.success).toBe(false);
        expect(result.aborted).toBe('stopped-waiting');

        await conn.destroy();

    });

    it('should leave a genuine query failure unmarked as aborted', async () => {

        const conn = await sqliteConnection();
        const controller = new AbortController();

        const result = await executeRawSqlUnchecked(conn.db, 'SELECT * FROM nope', 'test', {
            signal: controller.signal,
            dialect: 'sqlite',
        });

        expect(result.success).toBe(false);
        expect(result.aborted).toBeUndefined();

        await conn.destroy();

    });

    it('should keep the connection usable after a cancel, not poison it', async () => {

        const conn = await sqliteConnection();
        const controller = new AbortController();
        controller.abort();

        await executeRawSqlUnchecked(conn.db, 'SELECT 1 AS n', 'test', {
            signal: controller.signal,
            dialect: 'sqlite',
        });

        const after = await sql<{ n: number }>`SELECT 2 AS n`.execute(conn.db);

        expect(after.rows).toEqual([{ n: 2 }]);

        await conn.destroy();

    });

});

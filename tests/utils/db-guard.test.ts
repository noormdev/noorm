/**
 * Unit tests for the test-database naming-convention guard.
 *
 * Proves createTestConnection refuses to connect to anything that doesn't
 * look like a dedicated test database — the guard fires before any
 * connection attempt, so none of these tests require docker.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { attempt, attemptSync } from '@logosdx/utils';

import { assertTestDatabase, createTestConnection, NotATestDatabaseError, TEST_CONNECTIONS } from './db.js';
import type { ConnectionConfig, Dialect } from '../../src/core/connection/types.js';

function makeConfig(dialect: Dialect, database: string | undefined): ConnectionConfig {

    return { dialect, database } as unknown as ConnectionConfig;

}

describe('utils: assertTestDatabase', () => {

    it('accepts database names that look like test databases', () => {

        const accepted = [
            'noorm_test',
            'noorm_test_dest',
            ':memory:',
            'test',
            'my_test_db',
            'TEST-DB',
            'Test_Suite',
        ];

        for (const database of accepted) {

            expect(() => assertTestDatabase(makeConfig('postgres', database))).not.toThrow();

        }

    });

    it('rejects database names that do not look like test databases', () => {

        const rejected = ['production', 'noorm', 'attestation', 'contest', 'testdata', 'mytestdb', '', undefined];

        for (const database of rejected) {

            expect(() => assertTestDatabase(makeConfig('postgres', database))).toThrow(NotATestDatabaseError);

        }

    });

    it('names the database, the convention, and the remediation env var in the error message', () => {

        expect.assertions(4);

        const [, err] = attemptSync(() => assertTestDatabase(makeConfig('postgres', 'prod_analytics')));

        if (err instanceof NotATestDatabaseError) {

            expect(err.message).toContain('prod_analytics');
            expect(err.message).toContain('test');
            expect(err.message).toContain('TEST_POSTGRES_DATABASE');
            expect(err.database).toBe('prod_analytics');

        }

    });

    it('names the database as "(unset)" when database is undefined or empty', () => {

        expect.assertions(2);

        const [, undefinedErr] = attemptSync(() => assertTestDatabase(makeConfig('mysql', undefined)));
        const [, emptyErr] = attemptSync(() => assertTestDatabase(makeConfig('mysql', '')));

        if (undefinedErr instanceof NotATestDatabaseError) {

            expect(undefinedErr.message).toContain('(unset)');

        }

        if (emptyErr instanceof NotATestDatabaseError) {

            expect(emptyErr.message).toContain('(unset)');

        }

    });

    it('accepts the default TEST_CONNECTIONS entry for every dialect', () => {

        for (const dialect of Object.keys(TEST_CONNECTIONS) as Dialect[]) {

            expect(() => assertTestDatabase(TEST_CONNECTIONS[dialect])).not.toThrow();

        }

    });

});

describe('utils: createTestConnection guard', () => {

    const originalPostgresConfig = TEST_CONNECTIONS.postgres;

    beforeEach(() => {

        TEST_CONNECTIONS.postgres = originalPostgresConfig;

    });

    afterEach(() => {

        TEST_CONNECTIONS.postgres = originalPostgresConfig;

    });

    it('throws NotATestDatabaseError before attempting to connect', async () => {

        TEST_CONNECTIONS.postgres = { ...originalPostgresConfig, database: 'prod_analytics' };

        expect.assertions(1);

        const [, err] = await attempt(() => createTestConnection('postgres'));

        expect(err).toBeInstanceOf(NotATestDatabaseError);

    });

    it('resolves createTestConnection("sqlite") without docker (":memory:" passes the guard)', async () => {

        const conn = await createTestConnection('sqlite');

        expect(conn.db).toBeDefined();
        expect(conn.dialect).toBe('sqlite');

        await conn.destroy();

    });

});

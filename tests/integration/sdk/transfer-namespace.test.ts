/**
 * Integration tests for TransferNamespace against live postgres/mysql/mssql —
 * proves the tuple-to-throw contract (v1-25) holds against real
 * infrastructure, not the mocked/sqlite harness
 * `tests/sdk/transfer-dt-namespace.test.ts` already covers.
 *
 * `TransferNamespace` has no internal connection (no `#kysely`) — `to()`/
 * `plan()` open their own source+dest connections from the `Config` objects
 * passed in, so `NotConnectedError` is not a reachable failure path here.
 * The live-failure proof is an unreachable destination: a real closed port
 * that both methods must reject on, not resolve as a `[value, err]` tuple.
 *
 * The postgres-only happy-path case proves the success path isn't
 * tuple-shaped either — `transfer.plan()` must resolve a plain
 * `TransferPlan` object.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql, type Kysely } from 'kysely';

import { TransferNamespace } from '../../../src/sdk/namespaces/transfer.js';
import { createConnection } from '../../../src/core/connection/factory.js';
import {
    createTestConnection,
    deployTestSchema,
    teardownTestSchema,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';

import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Dialect } from '../../../src/core/connection/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeState(config: Config): ContextState {

    return {
        connection: null,
        config,
        settings: {},
        identity: { name: 'tester', source: 'system' },
        options: {},
        projectRoot: '/tmp',
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Suite factory — unreachable-dest failure proof, identical across
// dialects; only the connection config differs.
// ─────────────────────────────────────────────────────────────

function describeTransferNamespaceFailure(dialect: Dialect): void {

    describe(`sdk: TransferNamespace live throw contract (${dialect})`, () => {

        let transfer: TransferNamespace;
        let destConfig: Config;

        beforeAll(async () => {

            await skipIfNoContainer(dialect);

            const sourceConfig = makeTestConfig(`transfer-ns-src-${dialect}`, TEST_CONNECTIONS[dialect]);

            // Nothing listens on localhost:1 — connection attempts refuse
            // immediately (ECONNREFUSED) for pg/mysql2/tedious alike.
            destConfig = makeTestConfig(`transfer-ns-dest-${dialect}`, {
                ...TEST_CONNECTIONS[dialect],
                port: 1,
            });

            transfer = new TransferNamespace(makeState(sourceConfig));

        });

        it('transfer.to() rejects the underlying connection Error on an unreachable dest', async () => {

            await expect(transfer.to(destConfig)).rejects.toThrow();

        });

        it('transfer.plan() rejects the underlying connection Error on an unreachable dest', async () => {

            await expect(transfer.plan(destConfig)).rejects.toThrow();

        });

    });

}

describeTransferNamespaceFailure('postgres');
describeTransferNamespaceFailure('mysql');
describeTransferNamespaceFailure('mssql');

// ─────────────────────────────────────────────────────────────
// Happy path — proves the success shape isn't a tuple either.
// One dialect is sufficient (see spec's Out of scope); the
// failure-path proof above is what runs on all three.
// ─────────────────────────────────────────────────────────────

describe('sdk: TransferNamespace live throw contract (postgres happy path)', () => {

    let sourceDb: Kysely<unknown>;
    let destDb: Kysely<unknown>;
    let sourceDestroy: () => Promise<void>;
    let destDestroy: () => Promise<void>;
    let transfer: TransferNamespace;

    const sourceConfig = makeTestConfig('transfer-ns-plan-src', { ...TEST_CONNECTIONS.postgres });
    const destConfig = makeTestConfig('transfer-ns-plan-dest', {
        ...TEST_CONNECTIONS.postgres,
        database: process.env['TEST_POSTGRES_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const sourceConn = await createTestConnection('postgres');
        sourceDb = sourceConn.db;
        sourceDestroy = sourceConn.destroy;

        // Connect to the postgres system db to create the dest db if absent
        // — mirrors tests/integration/transfer/postgres.test.ts.
        const destDbName = destConfig.connection.database;
        const systemConn = await createConnection({
            ...TEST_CONNECTIONS.postgres,
            database: 'postgres',
        }, 'system');

        const dbCheck = await sql<{ exists: boolean }>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${destDbName}) as exists
        `.execute(systemConn.db);

        if (!dbCheck.rows[0]?.exists) {

            await sql.raw(`CREATE DATABASE "${destDbName}"`).execute(systemConn.db);

        }

        await systemConn.destroy();

        const destConn = await createConnection(destConfig.connection, 'transfer-ns-plan-dest');
        destDb = destConn.db;
        destDestroy = destConn.destroy;

        await teardownTestSchema(sourceDb, 'postgres');
        await deployTestSchema(sourceDb, 'postgres');

        await teardownTestSchema(destDb, 'postgres');
        await deployTestSchema(destDb, 'postgres');

        transfer = new TransferNamespace(makeState(sourceConfig));

    });

    afterAll(async () => {

        if (destDestroy) await destDestroy();
        if (sourceDestroy) await sourceDestroy();

    });

    it('transfer.plan() resolves a real TransferPlan object, not a tuple', async () => {

        const result = await transfer.plan(destConfig);

        expect(Array.isArray(result)).toBe(false);
        expect(result.tables.length).toBeGreaterThan(0);

    });

});

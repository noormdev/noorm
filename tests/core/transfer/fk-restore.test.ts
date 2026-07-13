/**
 * Transfer FK-restore surfacing tests (v1-03).
 *
 * Drives executeTransfer directly against a mocked destination Kysely
 * connection — no DB container required. Proves TransferResult.fkChecksRestored
 * is false only when the enable-FK attempt fails, true otherwise (success,
 * and disableForeignKeys: false where checks were never touched).
 */
import { describe, it, expect, vi } from 'bun:test';

import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import type { DualConnectionContext } from '../../../src/core/db/dual.js';
import type { TransferPlan } from '../../../src/core/transfer/types.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';

import { executeTransfer } from '../../../src/core/transfer/executor.js';
import { observer } from '../../../src/core/observer.js';
import { makeTestConfig, TEST_CONNECTIONS } from '../../utils/db.js';

// ─────────────────────────────────────────────────────────────
// Helpers — mock Kysely that records executed SQL and can inject a
// failure into any statement matching `failWhen`.
// ─────────────────────────────────────────────────────────────

function createRecordingDb(failWhen?: (sqlText: string) => boolean) {

    const db = new Kysely<NoormDatabase>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    const executed: string[] = [];
    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: vi.fn().mockImplementation((compiledQuery: { sql: string }) => {

                const stmt = compiledQuery.sql;
                executed.push(stmt);

                if (failWhen?.(stmt)) {

                    return Promise.reject(new Error(`injected failure: ${stmt}`));

                }

                return Promise.resolve({ rows: [] });

            }),
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return { db, executed };

}

/**
 * Minimal DualConnectionContext. `plan.tables` stays empty in every test
 * here, so the source connection is never touched — only `destination.db`
 * matters for the FK disable/enable calls under test.
 */
function makeContext(destDb: Kysely<NoormDatabase>): DualConnectionContext {

    return {
        source: {
            config: makeTestConfig('fk_restore_source', TEST_CONNECTIONS.postgres),
            db: destDb,
            dialect: 'postgres',
        },
        destination: {
            config: makeTestConfig('fk_restore_dest', TEST_CONNECTIONS.postgres),
            db: destDb,
            dialect: 'postgres',
        },
    };

}

const emptyPlan: TransferPlan = {
    tables: [],
    sameServer: false,
    estimatedRows: 0,
    warnings: [],
    crossDialect: false,
    sourceDialect: 'postgres',
    destinationDialect: 'postgres',
};

describe('transfer: executeTransfer fkChecksRestored', () => {

    it('is false when the enable-FK statement fails, status stays unaffected, and an error event is emitted', async () => {

        // postgresTransferOperations.getEnableFKSql() -> 'SET session_replication_role = DEFAULT'
        const { db } = createRecordingDb((stmt) => stmt.includes('DEFAULT'));
        const ctx = makeContext(db);

        const events: Array<{ source: string; error: Error }> = [];
        const unsub = observer.on('error', (data) => events.push(data));

        try {

            const [result, err] = await executeTransfer(ctx, emptyPlan, {});

            expect(err).toBeNull();
            expect(result?.fkChecksRestored).toBe(false);
            expect(result?.status).toBe('success');
            expect(events.some((e) => e.source === 'transfer')).toBe(true);

        }
        finally {

            unsub();

        }

    });

    it('is true when FK checks disable/enable both succeed', async () => {

        const { db } = createRecordingDb();
        const ctx = makeContext(db);

        const [result, err] = await executeTransfer(ctx, emptyPlan, {});

        expect(err).toBeNull();
        expect(result?.fkChecksRestored).toBe(true);

    });

    it('is true when disableForeignKeys: false — checks were never touched', async () => {

        const { db, executed } = createRecordingDb();
        const ctx = makeContext(db);

        const [result, err] = await executeTransfer(ctx, emptyPlan, { disableForeignKeys: false });

        expect(err).toBeNull();
        expect(result?.fkChecksRestored).toBe(true);
        expect(executed).toEqual([]);

    });

});

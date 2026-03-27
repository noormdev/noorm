/**
 * Scope builder tests.
 *
 * Verifies that buildScope wires proc/func/transaction to the
 * dedicated connection and that revert is idempotent.
 */
import { describe, it, expect, vi } from 'bun:test';
import {
    Kysely,
    DummyDriver,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
} from 'kysely';

import { buildScope } from '../../../src/sdk/impersonate/scope.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function createMockKysely(rows: Record<string, unknown>[] = []) {

    const executeQueryMock = vi.fn().mockResolvedValue({ rows });

    const db = new Kysely<unknown>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    const originalExecutor = db.getExecutor();

    vi.spyOn(originalExecutor, 'provideConnection').mockImplementation(async (consumer) => {

        return consumer({
            executeQuery: executeQueryMock,
            streamQuery: () => {

                throw new Error('not implemented');

            },
        });

    });

    return { db, executeQueryMock };

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate buildScope', () => {

    it('should expose the kysely instance', () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn();
        const scope = buildScope(db, revertFn, 'postgres');

        expect(scope.kysely).toBe(db);

    });

    it('should route proc() through the scoped connection', async () => {

        const mockRows = [{ id: 1 }];
        const { db, executeQueryMock } = createMockKysely(mockRows);
        const scope = buildScope(db, vi.fn(), 'postgres');

        const result = await scope.proc('get_users', { department_id: 1 });

        expect(result).toEqual(mockRows);
        expect(executeQueryMock).toHaveBeenCalled();

    });

    it('should route func() through the scoped connection', async () => {

        const mockRows = [{ total: 99 }];
        const { db, executeQueryMock } = createMockKysely(mockRows);
        const scope = buildScope(db, vi.fn(), 'postgres');

        const result = await scope.func('calc_total', { order_id: 42 }, 'total');

        expect(result).toEqual({ total: 99 });
        expect(executeQueryMock).toHaveBeenCalled();

    });

    it('should call revertFn on revert()', async () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn();
        const scope = buildScope(db, revertFn, 'postgres');

        await scope.revert();

        expect(revertFn).toHaveBeenCalledTimes(1);

    });

    it('should make revert() idempotent', async () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn();
        const scope = buildScope(db, revertFn, 'postgres');

        await scope.revert();
        await scope.revert();
        await scope.revert();

        expect(revertFn).toHaveBeenCalledTimes(1);

    });

});

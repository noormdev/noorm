/**
 * Scope builder tests.
 *
 * Verifies that buildScope wires proc/func/transaction to the
 * dedicated connection and that revert is idempotent.
 */
import { describe, it, expect, vi } from 'bun:test';
import { attempt } from '@logosdx/utils';
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

    /**
     * The idempotency above only covers a revert that SUCCEEDS. `reverted` was
     * set before `revertFn` was awaited, so a revert that threw still marked
     * the scope reverted: the caller's retry returned early, the revert SQL
     * never ran, and the pooled connection the scope holds was never released
     * — permanently, taking `disconnect()` down with it.
     */
    it('should stay revertible when revertFn fails, so a retry can succeed', async () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn()
            .mockRejectedValueOnce(new Error('connection error, not queryable'))
            .mockResolvedValueOnce(undefined);

        const scope = buildScope(db, revertFn, 'postgres');

        const [, firstErr] = await attempt(() => scope.revert());

        expect(firstErr).toBeInstanceOf(Error);

        const [, secondErr] = await attempt(() => scope.revert());

        expect(secondErr).toBeNull();
        expect(revertFn).toHaveBeenCalledTimes(2);

    });

    it('should surface the revert failure rather than swallowing it', async () => {

        const { db } = createMockKysely();
        const revertFn = vi.fn().mockRejectedValue(new Error('revert blew up'));

        const scope = buildScope(db, revertFn, 'postgres');

        const [, err] = await attempt(() => scope.revert());

        expect((err as Error).message).toContain('revert blew up');

    });

    it('should run revertFn once when revert() is called concurrently', async () => {

        const { db } = createMockKysely();

        let release!: () => void;
        const gate = new Promise<void>((resolve) => {

            release = resolve;

        });

        const revertFn = vi.fn().mockImplementation(() => gate);
        const scope = buildScope(db, revertFn, 'postgres');

        const first = scope.revert();
        const second = scope.revert();

        release();

        await Promise.all([first, second]);

        expect(revertFn).toHaveBeenCalledTimes(1);

    });

});

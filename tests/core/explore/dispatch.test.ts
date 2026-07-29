/**
 * Tests for the dialect-agnostic explore entry points.
 *
 * `fetchOverview` / `fetchList` / `fetchDetail` had no unit coverage at all,
 * which is where the "counts differ by code path" and "--schema does nothing"
 * defects lived.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { fetchOverview, fetchList, fetchDetail } from '../../../src/core/explore/index.js';
import { observer } from '../../../src/core/observer.js';
import { createRecordingDb } from './recording-db.js';

let errors: { source?: string; error?: Error }[] = [];
let unsubscribe: (() => void) | null = null;

beforeEach(() => {

    errors = [];
    unsubscribe = observer.on('error', (data) => {

        errors.push(data as { source?: string; error?: Error });

    }) as unknown as () => void;

});

afterEach(() => {

    unsubscribe?.();

});

describe('explore: fetchOverview', () => {

    it('should emit an error event when the default path fails', async () => {

        // Only the includeNoormTables branch used to emit, so every CLI, SDK
        // and TUI overview failure was invisible to the logger and the toast.
        const db = createRecordingDb('postgres', [
            { match: /information_schema\.tables/, error: new Error('connection lost') },
        ]);

        const [, err] = await attempt(() => fetchOverview(db.kysely, 'postgres'));

        expect(err).toBeInstanceOf(Error);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.source).toBe('explore');

    });

    it('should emit an error event when the includeNoormTables path fails', async () => {

        const db = createRecordingDb('postgres', [
            { match: /information_schema\.tables/, error: new Error('connection lost') },
        ]);

        const [, err] = await attempt(() =>
            fetchOverview(db.kysely, 'postgres', { includeNoormTables: true }),
        );

        expect(err).toBeInstanceOf(Error);
        expect(errors).toHaveLength(1);

    });

    it('should count triggers, locks and connections rather than reporting zero', async () => {

        // These three were hardcoded to 0 with a `TODO: implement count` on the
        // includeNoormTables path, so turning on verbose logging zeroed them.
        const db = createRecordingDb('postgres', [
            { match: /information_schema\.tables/, rows: [{ table_name: 'users' }] },
            { match: /information_schema\.views/, rows: [] },
            { match: /FROM pg_proc/, rows: [] },
            { match: /FROM pg_proc/, rows: [] },
            { match: /FROM pg_type/, rows: [] },
            { match: /pg_indexes/, rows: [] },
            { match: /table_constraints/, rows: [] },
            {
                match: /information_schema\.triggers/,
                rows: [
                    {
                        trigger_name: 't_orders',
                        trigger_schema: 'public',
                        event_object_table: 'orders',
                        event_object_schema: 'public',
                        action_timing: 'BEFORE',
                        event_manipulation: 'INSERT',
                    },
                ],
            },
            { match: /pg_locks/, rows: [{ pid: 1, locktype: 'relation', relation: null, mode: 'S', granted: true }] },
            {
                match: /pg_stat_activity/,
                rows: [
                    { pid: 2, usename: 'u', datname: 'd', application_name: '', client_addr: null, backend_start: new Date(), state: 'idle' },
                    { pid: 3, usename: 'u', datname: 'd', application_name: '', client_addr: null, backend_start: new Date(), state: 'idle' },
                ],
            },
        ]);

        const overview = await fetchOverview(db.kysely, 'postgres', { includeNoormTables: true });

        expect(overview.triggers).toBe(1);
        expect(overview.locks).toBe(1);
        expect(overview.connections).toBe(2);

    });

    it('should report identical counts on both option paths', async () => {

        const rules = () => [
            {
                match: /information_schema\.tables/,
                rows: [
                    { table_name: 'users', table_schema: 'public', column_count: '2', row_estimate: '0' },
                    { table_name: 'orders', table_schema: 'public', column_count: '3', row_estimate: '0' },
                ],
            },
            { match: /information_schema\.triggers/, rows: [] },
        ];

        const withoutNoorm = await fetchOverview(
            createRecordingDb('postgres', rules()).kysely,
            'postgres',
        );

        const withNoorm = await fetchOverview(
            createRecordingDb('postgres', rules()).kysely,
            'postgres',
            { includeNoormTables: true },
        );

        expect(withNoorm).toEqual(withoutNoorm);

    });

    it('should exclude noorm bookkeeping tables unless asked for them', async () => {

        const rules = () => [
            {
                match: /information_schema\.tables/,
                rows: [
                    { table_name: 'users', table_schema: 'public', column_count: '2', row_estimate: '0' },
                    { table_name: '__noorm_change__', table_schema: 'public', column_count: '4', row_estimate: '0' },
                ],
            },
            { match: /information_schema\.triggers/, rows: [] },
        ];

        const hidden = await fetchOverview(createRecordingDb('postgres', rules()).kysely, 'postgres');
        const shown = await fetchOverview(
            createRecordingDb('postgres', rules()).kysely,
            'postgres',
            { includeNoormTables: true },
        );

        expect(hidden.tables).toBe(1);
        expect(shown.tables).toBe(2);

    });

});

describe('explore: fetchList', () => {

    it('should push a schema filter down into the dialect query', async () => {

        // The CLI accepted --schema on list commands and dropped it on the
        // floor; the filter has to reach the generated SQL to mean anything.
        const db = createRecordingDb('postgres', [{ match: /information_schema\.views/, rows: [] }]);

        await fetchList(db.kysely, 'postgres', 'views', { schema: 'app' });

        expect(db.find(/information_schema\.views/)?.parameters).toContain('app');

    });

    it('should reject a schema filter on sqlite, which has no schemas', async () => {

        const db = createRecordingDb('sqlite');

        const [, err] = await attempt(() =>
            fetchList(db.kysely, 'sqlite', 'tables', { schema: 'app' }),
        );

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('schema');
        expect(db.queries).toHaveLength(0);

    });

    it('should emit an error event and rethrow when the query fails', async () => {

        const db = createRecordingDb('postgres', [
            { match: /information_schema\.tables/, error: new Error('boom') },
        ]);

        const [, err] = await attempt(() => fetchList(db.kysely, 'postgres', 'tables'));

        expect(err?.message).toBe('boom');
        expect(errors).toHaveLength(1);

    });

    it('should filter noorm bookkeeping objects out of every category that names a table', async () => {

        const db = createRecordingDb('postgres', [
            {
                match: /pg_indexes/,
                rows: [
                    { indexname: 'i1', schemaname: 'public', tablename: 'users', indexdef: 'CREATE INDEX i1 ON users (id)', is_primary: false },
                    { indexname: 'i2', schemaname: 'public', tablename: '__noorm_change__', indexdef: 'CREATE INDEX i2 ON x (id)', is_primary: false },
                ],
            },
        ]);

        const indexes = await fetchList(db.kysely, 'postgres', 'indexes');

        expect(indexes.map((i) => i.tableName)).toEqual(['users']);

    });

});

describe('explore: fetchDetail', () => {

    it('should emit an error event and rethrow when the query fails', async () => {

        const db = createRecordingDb('postgres', [
            { match: /information_schema\.columns/, error: new Error('nope') },
        ]);

        const [, err] = await attempt(() =>
            fetchDetail(db.kysely, 'postgres', 'tables', 'users', 'public'),
        );

        expect(err?.message).toBe('nope');
        expect(errors).toHaveLength(1);

    });

    it('should return null rather than throwing when the object is absent', async () => {

        const db = createRecordingDb('postgres');

        const detail = await fetchDetail(db.kysely, 'postgres', 'tables', 'ghost', 'public');

        expect(detail).toBeNull();
        expect(errors).toHaveLength(0);

    });

});

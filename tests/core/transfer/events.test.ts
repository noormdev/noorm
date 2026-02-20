/**
 * Transfer event emission tests.
 *
 * Tests that transfer operations emit correct observer events
 * for CLI progress tracking and UI feedback.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'kysely';

import type { Kysely } from 'kysely';

import { transferData, getTransferPlan } from '../../../src/core/transfer/index.js';
import { observer } from '../../../src/core/observer.js';
import {
    createTestConnection,
    deployTestSchema,
    seedTestData,
    resetTestData,
    teardownTestSchema,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';
import { createConnection } from '../../../src/core/connection/factory.js';

/**
 * Create Config objects for source and destination.
 */
function makeConfigs() {

    const sourceConfig = makeTestConfig('events_source', { ...TEST_CONNECTIONS.postgres });

    const destConfig = makeTestConfig('events_dest', {
        ...TEST_CONNECTIONS.postgres,
        database: process.env['TEST_POSTGRES_DATABASE_DEST'] ?? 'noorm_test_dest',
    });

    return { sourceConfig, destConfig };

}

describe('transfer: event emissions', () => {

    let sourceDb: Kysely<unknown>;
    let destDb: Kysely<unknown>;
    let sourceDestroy: () => Promise<void>;
    let destDestroy: () => Promise<void>;

    const { sourceConfig, destConfig } = makeConfigs();

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        // Connect to source
        const conn = await createTestConnection('postgres');
        sourceDb = conn.db;
        sourceDestroy = conn.destroy;

        // Connect to postgres system database to create destination if needed
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

        // Connect to destination
        const destConn = await createConnection(destConfig.connection, 'events_dest');
        destDb = destConn.db;
        destDestroy = destConn.destroy;

        // Deploy schema
        await teardownTestSchema(sourceDb, 'postgres');
        await deployTestSchema(sourceDb, 'postgres');

        await teardownTestSchema(destDb, 'postgres');
        await deployTestSchema(destDb, 'postgres');

    });

    afterAll(async () => {

        if (destDestroy) await destDestroy();
        if (sourceDestroy) await sourceDestroy();

    });

    beforeEach(async () => {

        await resetTestData(sourceDb, 'postgres');
        await seedTestData(sourceDb, 'postgres');
        await resetTestData(destDb, 'postgres');

    });

    describe('getTransferPlan events', () => {

        it('should emit transfer:planning when planning starts', async () => {

            const events: Array<{ source: string; destination: string }> = [];
            const unsub = observer.on('transfer:planning', (data) => events.push(data));

            try {

                await getTransferPlan(sourceConfig, destConfig);

                expect(events.length).toBe(1);
                expect(events[0]!.source).toBe('events_source');
                expect(events[0]!.destination).toBe('events_dest');

            }
            finally {

                unsub();

            }

        });

        it('should emit transfer:plan:ready with plan details', async () => {

            const events: Array<{
                sameServer: boolean;
                tableCount: number;
                estimatedRows: number;
                warnings: string[];
            }> = [];

            const unsub = observer.on('transfer:plan:ready', (data) => events.push(data));

            try {

                await getTransferPlan(sourceConfig, destConfig);

                expect(events.length).toBe(1);
                expect(typeof events[0]!.sameServer).toBe('boolean');
                expect(events[0]!.tableCount).toBeGreaterThanOrEqual(3);
                expect(Array.isArray(events[0]!.warnings)).toBe(true);

            }
            finally {

                unsub();

            }

        });

    });

    describe('transferData events', () => {

        it('should emit transfer:starting when execution begins', async () => {

            const events: Array<{ tableCount: number; sameServer: boolean }> = [];
            const unsub = observer.on('transfer:starting', (data) => events.push(data));

            try {

                await transferData(sourceConfig, destConfig, {
                    tables: ['users'],
                });

                expect(events.length).toBe(1);
                expect(events[0]!.tableCount).toBe(1);
                expect(typeof events[0]!.sameServer).toBe('boolean');

            }
            finally {

                unsub();

            }

        });

        it('should emit transfer:table:before for each table', async () => {

            const events: Array<{
                table: string;
                index: number;
                total: number;
                rowCount: number;
            }> = [];

            const unsub = observer.on('transfer:table:before', (data) => events.push(data));

            try {

                await transferData(sourceConfig, destConfig, {
                    tables: ['users', 'todo_lists'],
                });

                expect(events.length).toBe(2);

                // First table
                expect(events[0]!.index).toBe(0);
                expect(events[0]!.total).toBe(2);

                // Second table
                expect(events[1]!.index).toBe(1);
                expect(events[1]!.total).toBe(2);

            }
            finally {

                unsub();

            }

        });

        it('should emit transfer:table:progress during transfers', async () => {

            const events: Array<{
                table: string;
                rowsTransferred: number;
                rowsTotal: number;
                rowsSkipped: number;
            }> = [];

            const unsub = observer.on('transfer:table:progress', (data) => events.push(data));

            try {

                await transferData(sourceConfig, destConfig, {
                    tables: ['users'],
                });

                // At least one progress event per table
                expect(events.length).toBeGreaterThanOrEqual(1);
                expect(events[0]!.table).toBe('users');
                expect(typeof events[0]!.rowsTransferred).toBe('number');

            }
            finally {

                unsub();

            }

        });

        it('should emit transfer:table:after with results', async () => {

            const events: Array<{
                table: string;
                status: 'success' | 'skipped' | 'failed';
                rowsTransferred: number;
                rowsSkipped: number;
                durationMs: number;
                error?: string;
            }> = [];

            const unsub = observer.on('transfer:table:after', (data) => events.push(data));

            try {

                await transferData(sourceConfig, destConfig, {
                    tables: ['users'],
                });

                expect(events.length).toBe(1);
                expect(events[0]!.table).toBe('users');
                expect(events[0]!.status).toBe('success');
                expect(events[0]!.rowsTransferred).toBeGreaterThanOrEqual(0);
                expect(typeof events[0]!.durationMs).toBe('number');

            }
            finally {

                unsub();

            }

        });

        it('should emit transfer:complete with final status', async () => {

            const events: Array<{
                status: 'success' | 'partial' | 'failed';
                totalRows: number;
                tableCount: number;
                durationMs: number;
            }> = [];

            const unsub = observer.on('transfer:complete', (data) => events.push(data));

            try {

                await transferData(sourceConfig, destConfig, {
                    tables: ['users', 'todo_lists'],
                });

                expect(events.length).toBe(1);
                expect(events[0]!.status).toBe('success');
                expect(events[0]!.tableCount).toBe(2);
                expect(events[0]!.totalRows).toBeGreaterThanOrEqual(0);
                expect(typeof events[0]!.durationMs).toBe('number');

            }
            finally {

                unsub();

            }

        });

    });

    describe('event sequence', () => {

        it('should emit events in correct order', async () => {

            const eventOrder: string[] = [];

            const unsubs = [
                observer.on('transfer:planning', () => eventOrder.push('planning')),
                observer.on('transfer:plan:ready', () => eventOrder.push('plan:ready')),
                observer.on('transfer:starting', () => eventOrder.push('starting')),
                observer.on('transfer:table:before', () => eventOrder.push('table:before')),
                observer.on('transfer:table:progress', () => eventOrder.push('table:progress')),
                observer.on('transfer:table:after', () => eventOrder.push('table:after')),
                observer.on('transfer:complete', () => eventOrder.push('complete')),
            ];

            try {

                await transferData(sourceConfig, destConfig, {
                    tables: ['users'],
                });

                // Verify order
                expect(eventOrder.indexOf('planning')).toBeLessThan(eventOrder.indexOf('plan:ready'));
                expect(eventOrder.indexOf('plan:ready')).toBeLessThan(eventOrder.indexOf('starting'));
                expect(eventOrder.indexOf('starting')).toBeLessThan(eventOrder.indexOf('table:before'));
                expect(eventOrder.indexOf('table:before')).toBeLessThan(eventOrder.indexOf('table:after'));
                expect(eventOrder.indexOf('table:after')).toBeLessThan(eventOrder.indexOf('complete'));

            }
            finally {

                for (const unsub of unsubs) unsub();

            }

        });

    });

});

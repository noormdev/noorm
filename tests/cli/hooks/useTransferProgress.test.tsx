/**
 * useTransferProgress hook tests.
 *
 * Tests event handlers for transfer and dt:import progress tracking.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text, Box } from 'ink';

import { observer } from '../../../src/core/observer.js';
import { NoormObserver } from '../../../src/cli/observer-context.js';
import { useTransferProgress } from '../../../src/cli/hooks/useTransferProgress.js';

/**
 * Test component that renders transfer progress state.
 */
function TransferProgressView() {

    const { state } = useTransferProgress();

    return (
        <Box flexDirection="column">
            <Text>phase:{state.phase}</Text>
            <Text>rowsTransferred:{state.rowsTransferred}</Text>
            <Text>rowsSkipped:{state.rowsSkipped}</Text>
            <Text>currentRowsTransferred:{state.currentRowsTransferred}</Text>
            <Text>currentRowsTotal:{state.currentRowsTotal}</Text>
            <Text>tablesCompleted:{state.tablesCompleted}</Text>
            <Text>currentTable:{state.currentTable ?? 'none'}</Text>
            <Text>sameServer:{String(state.sameServer)}</Text>
        </Box>
    );

}

/**
 * Wrap component with NoormObserver provider for testing.
 */
function WithProvider({ children }: { children: React.ReactNode }) {

    return <NoormObserver>{children}</NoormObserver>;

}

describe('cli: hooks/useTransferProgress', () => {

    describe('dt:import events', () => {

        it('should update aggregate rowsTransferred on dt:import:progress', async () => {

            const { lastFrame, unmount } = render(<WithProvider><TransferProgressView /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            // Start an import
            observer.emit('dt:import:start', {
                filepath: '/tmp/test.dt',
                table: 'users',
                sourceDialect: 'postgres',
                sourceVersion: '16',
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('currentTable:users');
            expect(lastFrame()).toContain('phase:running');

            // Emit progress — should update both current and aggregate
            observer.emit('dt:import:progress', {
                rowsImported: 500,
                rowsSkipped: 10,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('currentRowsTransferred:500');
            expect(lastFrame()).toContain('rowsTransferred:500');

            // Emit more progress — aggregate should track delta
            observer.emit('dt:import:progress', {
                rowsImported: 1000,
                rowsSkipped: 20,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('currentRowsTransferred:1000');
            expect(lastFrame()).toContain('rowsTransferred:1000');

            unmount();

        });

        it('should not set phase to complete on dt:import:complete', async () => {

            const { lastFrame, unmount } = render(<WithProvider><TransferProgressView /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            // Start an import
            observer.emit('dt:import:start', {
                filepath: '/tmp/test.dt',
                table: 'users',
                sourceDialect: 'postgres',
                sourceVersion: '16',
            });
            await new Promise((r) => setTimeout(r, 10));

            // Complete the import
            observer.emit('dt:import:complete', {
                rowsImported: 1000,
                rowsSkipped: 5,
                durationMs: 500,
            });
            await new Promise((r) => setTimeout(r, 10));

            // Phase should remain 'running', not 'complete'
            expect(lastFrame()).toContain('phase:running');
            expect(lastFrame()).toContain('rowsTransferred:1000');
            expect(lastFrame()).toContain('tablesCompleted:1');
            expect(lastFrame()).toContain('currentTable:none');

            unmount();

        });

        it('should track multi-file imports without premature completion', async () => {

            const { lastFrame, unmount } = render(<WithProvider><TransferProgressView /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            // First file
            observer.emit('dt:import:start', {
                filepath: '/tmp/users.dt',
                table: 'users',
                sourceDialect: 'postgres',
                sourceVersion: '16',
            });
            await new Promise((r) => setTimeout(r, 10));

            observer.emit('dt:import:progress', {
                rowsImported: 500,
                rowsSkipped: 0,
            });
            await new Promise((r) => setTimeout(r, 10));

            observer.emit('dt:import:complete', {
                rowsImported: 500,
                rowsSkipped: 0,
                durationMs: 200,
            });
            await new Promise((r) => setTimeout(r, 10));

            // Still running — not complete
            expect(lastFrame()).toContain('phase:running');
            expect(lastFrame()).toContain('rowsTransferred:500');
            expect(lastFrame()).toContain('tablesCompleted:1');

            // Second file
            observer.emit('dt:import:start', {
                filepath: '/tmp/orders.dt',
                table: 'orders',
                sourceDialect: 'postgres',
                sourceVersion: '16',
            });
            await new Promise((r) => setTimeout(r, 10));

            observer.emit('dt:import:progress', {
                rowsImported: 300,
                rowsSkipped: 0,
            });
            await new Promise((r) => setTimeout(r, 10));

            // Aggregate should include both tables
            expect(lastFrame()).toContain('rowsTransferred:800');
            expect(lastFrame()).toContain('currentRowsTransferred:300');

            observer.emit('dt:import:complete', {
                rowsImported: 300,
                rowsSkipped: 0,
                durationMs: 150,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('rowsTransferred:800');
            expect(lastFrame()).toContain('tablesCompleted:2');

            unmount();

        });

    });

    describe('transfer:table events', () => {

        it('should update aggregate rowsTransferred on transfer:table:progress', async () => {

            const { lastFrame, unmount } = render(<WithProvider><TransferProgressView /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            // Start transfer
            observer.emit('transfer:starting', {
                tableCount: 2,
                sameServer: false,
            });
            await new Promise((r) => setTimeout(r, 10));

            // Begin table
            observer.emit('transfer:table:before', {
                table: 'users',
                index: 0,
                rowCount: 1000,
            });
            await new Promise((r) => setTimeout(r, 10));

            // Progress
            observer.emit('transfer:table:progress', {
                table: 'users',
                rowsTransferred: 500,
                rowsSkipped: 0,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('currentRowsTransferred:500');
            expect(lastFrame()).toContain('rowsTransferred:500');

            // More progress
            observer.emit('transfer:table:progress', {
                table: 'users',
                rowsTransferred: 800,
                rowsSkipped: 0,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('currentRowsTransferred:800');
            expect(lastFrame()).toContain('rowsTransferred:800');

            unmount();

        });

        it('should not double-count rows on transfer:table:after', async () => {

            const { lastFrame, unmount } = render(<WithProvider><TransferProgressView /></WithProvider>);

            await new Promise((r) => setTimeout(r, 10));

            // Start
            observer.emit('transfer:starting', {
                tableCount: 2,
                sameServer: false,
            });
            await new Promise((r) => setTimeout(r, 10));

            // First table
            observer.emit('transfer:table:before', {
                table: 'users',
                index: 0,
                rowCount: 1000,
            });
            await new Promise((r) => setTimeout(r, 10));

            observer.emit('transfer:table:progress', {
                table: 'users',
                rowsTransferred: 1000,
                rowsSkipped: 5,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('rowsTransferred:1000');

            // Complete first table — should NOT double-count
            observer.emit('transfer:table:after', {
                table: 'users',
                status: 'success',
                rowsTransferred: 1000,
                rowsSkipped: 5,
                durationMs: 300,
            });
            await new Promise((r) => setTimeout(r, 10));

            // Should still be 1000, not 2000
            expect(lastFrame()).toContain('rowsTransferred:1000');
            expect(lastFrame()).toContain('tablesCompleted:1');
            expect(lastFrame()).toContain('currentRowsTransferred:0');

            // Second table
            observer.emit('transfer:table:before', {
                table: 'orders',
                index: 1,
                rowCount: 500,
            });
            await new Promise((r) => setTimeout(r, 10));

            observer.emit('transfer:table:progress', {
                table: 'orders',
                rowsTransferred: 500,
                rowsSkipped: 0,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('rowsTransferred:1500');

            observer.emit('transfer:table:after', {
                table: 'orders',
                status: 'success',
                rowsTransferred: 500,
                rowsSkipped: 0,
                durationMs: 200,
            });
            await new Promise((r) => setTimeout(r, 10));

            expect(lastFrame()).toContain('rowsTransferred:1500');
            expect(lastFrame()).toContain('tablesCompleted:2');

            unmount();

        });

    });

});

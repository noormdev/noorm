/**
 * Global dry-run wiring for the destructive `db` screens.
 *
 * `D` toggles dry-run from anywhere and the status bar renders the DRY badge
 * app-wide (src/tui/app.tsx), but only the change and run screens ever read
 * `globalModes`. `truncateData` and `teardownSchema` both accept `dryRun`
 * (src/core/teardown/types.ts) and the CLI passes it, so a user could toggle
 * DRY, watch the badge, confirm, and have the schema dropped for real -- the
 * same class as the change-screen defect fixed in change-dry-run.test.tsx.
 *
 * `truncateData`/`teardownSchema` are swapped via `mock.module` to record the
 * options object rather than touch a database; the connection itself is a real
 * in-memory sqlite one through the real ConnectionProvider.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React, { useEffect } from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TruncateOptions, TeardownOptions } from '../../../../src/core/teardown/types.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider, useAppContext } from '../../../../src/tui/app-context.js';
import { ConnectionProvider } from '../../../../src/tui/providers/ConnectionProvider.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { DbTruncateScreen } from '../../../../src/tui/screens/db/DbTruncateScreen.js';
import { DbTeardownScreen } from '../../../../src/tui/screens/db/DbTeardownScreen.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualTeardown = await import('../../../../src/core/teardown/index.js');
const actualExplore = await import('../../../../src/core/explore/operations.js');

/** Options objects handed to the two core entry points. */
const truncateCalls: TruncateOptions[] = [];
const teardownCalls: TeardownOptions[] = [];

mock.module('../../../../src/core/teardown/index.js', () => ({
    ...actualTeardown,
    truncateData: vi.fn(async (_db: unknown, _dialect: unknown, options: TruncateOptions) => {

        truncateCalls.push(options);

        return { tablesTruncated: [], rowsDeleted: 0, skipped: [] };

    }),
    teardownSchema: vi.fn(async (_db: unknown, _dialect: unknown, options: TeardownOptions) => {

        teardownCalls.push(options);

        return {
            dropped: { tables: [], views: [], functions: [], procedures: [], types: [], foreignKeys: [] },
            preserved: [],
            durationMs: 0,
        };

    }),
}));

mock.module('../../../../src/core/explore/operations.js', () => ({
    ...actualExplore,
    fetchList: vi.fn(async () => [{ name: 'widgets', schema: 'main', rowCount: 3 }]),
}));

/** Admin sqlite config: `db:reset` is `allow`, so the plain confirm renders. */
function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, agent: 'admin' as const },
        connection: {
            dialect: 'sqlite' as const,
            database: ':memory:',
        },
    };

}

const createMockStateManager = () => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(makeConfig()),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn().mockReturnValue([makeConfig()]),
    getConfig: vi.fn().mockReturnValue(makeConfig()),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
});

const createMockSettingsManager = () => ({
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
});

let mockStateManager = createMockStateManager();
let mockSettingsManager = createMockSettingsManager();

mock.module('../../../../src/core/index.js', () => ({
    observer: actualCore.observer,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

/** Drives dry-run through the real setter, as the global `D` hotkey does. */
function GlobalModeSetter({ dryRun }: { dryRun: boolean }): null {

    const { globalModes, toggleDryRun } = useAppContext();

    useEffect(() => {

        if (globalModes.dryRun !== dryRun) toggleDryRun();

    }, [globalModes, dryRun, toggleDryRun]);

    return null;

}

describe('cli: destructive db screens honour global dry-run', () => {

    let tempDir: string;

    const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));

    function tree(Screen: React.ComponentType<{ params: object }>, dryRun: boolean) {

        return (
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ConnectionProvider>
                            <ToastProvider>
                                <GlobalModeSetter dryRun={dryRun} />
                                <Screen params={{}} />
                            </ToastProvider>
                        </ConnectionProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>
        );

    }

    beforeEach(async () => {

        vi.clearAllMocks();
        actualCore.observer.clear();

        delete process.env['NOORM_YES'];

        truncateCalls.length = 0;
        teardownCalls.length = 0;
        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-db-dry-test-'));

    });

    afterEach(async () => {

        actualCore.observer.clear();

        await rm(tempDir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../../src/core/teardown/index.js', () => actualTeardown);
        mock.module('../../../../src/core/explore/operations.js', () => actualExplore);

    });

    describe('DbTruncateScreen', () => {

        async function runTruncate(dryRun: boolean) {

            const { stdin, lastFrame, unmount } = render(tree(DbTruncateScreen, dryRun));

            await tick(600);

            // preview -> confirm
            stdin.write('\r');
            await tick();

            expect(lastFrame() ?? '').toContain('Confirm');

            // previewTeardown/preview passes run their own dry-run probes
            // through these same entry points; only the post-confirm call is
            // the one under test.
            truncateCalls.length = 0;

            stdin.write('yes-test');
            await tick();
            stdin.write('\r');
            await tick(400);

            unmount();

            expect(truncateCalls).toHaveLength(1);

            return truncateCalls[0];

        }

        it('should pass dryRun: true when global dry-run is on', async () => {

            const options = await runTruncate(true);

            expect(options?.dryRun).toBe(true);

        });

        it('should pass dryRun: false when global dry-run is off', async () => {

            const options = await runTruncate(false);

            expect(options?.dryRun).toBe(false);

        });

    });

    describe('DbTeardownScreen', () => {

        async function runTeardown(dryRun: boolean) {

            const { stdin, lastFrame, unmount } = render(tree(DbTeardownScreen, dryRun));

            await tick(600);

            stdin.write('\r');
            await tick();

            expect(lastFrame() ?? '').toContain('Confirm');

            // previewTeardown runs a dry-run teardown of its own to build the
            // preview; only the post-confirm call is the one under test.
            teardownCalls.length = 0;

            stdin.write('yes-test');
            await tick();
            stdin.write('\r');
            await tick(400);

            unmount();

            expect(teardownCalls).toHaveLength(1);

            return teardownCalls[0];

        }

        it('should pass dryRun: true when global dry-run is on', async () => {

            const options = await runTeardown(true);

            expect(options?.dryRun).toBe(true);

        });

        it('should pass dryRun: false when global dry-run is off', async () => {

            const options = await runTeardown(false);

            expect(options?.dryRun).toBe(false);

        });

    });

});

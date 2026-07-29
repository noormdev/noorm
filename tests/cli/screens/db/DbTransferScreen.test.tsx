/**
 * DbTransferScreen policy-gate and option-wiring tests.
 *
 * `db transfer` writes into the *destination* config, so the SDK gates it
 * against that config rather than the active one
 * (src/sdk/namespaces/transfer.ts -> checkProtectedConfig(destConfig, ...,
 * 'db:reset')). The TUI screen imported core `transferData` directly, which
 * only asserts `allowed` and treats a `confirm` cell as pass -- so a
 * confirm-tier destination was writable from the TUI behind a single `y`
 * keypress while the CLI hard-blocked. These tests pin the destination as the
 * gated principal, and pin the confirm tier to the type-to-confirm dialog.
 *
 * The option assertions cover the second half: `truncateFirst` was declared
 * with a setter that was never called, and `globalModes.dryRun` was never
 * read, so the TUI always transferred with both false regardless of what the
 * status bar advertised.
 *
 * Drives the real screen through the real providers. `core/transfer` is
 * swapped via `mock.module` (precedent: tests/cli/screens/change/change-dry-run.test.tsx)
 * so the screen's own call is observed without touching a database.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React, { useEffect } from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '../../../../src/core/config/types.js';
import type { Role } from '../../../../src/core/policy/types.js';
import type { TransferOptions, TransferPlan, TransferResult } from '../../../../src/core/transfer/types.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider, useAppContext } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { DbTransferScreen } from '../../../../src/tui/screens/db/DbTransferScreen.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualTransfer = await import('../../../../src/core/transfer/index.js');

/** Options object handed to `transferData` on each invocation. */
const transferCalls: TransferOptions[] = [];

/** Destination config `transferData` was called against, per invocation. */
const transferDests: Config[] = [];

/** Down-arrow escape sequence, as Ink's stdin parser expects it. */
const DOWN = '\u001B[B';

/** A two-table plan; the screen only reads `tables`/`estimatedRows` here. */
function makePlan(): TransferPlan {

    return {
        tables: [
            {
                name: 'users',
                rowCount: 10,
                hasIdentity: false,
                primaryKey: ['id'],
                columns: ['id'],
                dependsOn: [],
            },
            {
                name: 'posts',
                rowCount: 5,
                hasIdentity: false,
                primaryKey: ['id'],
                columns: ['id'],
                dependsOn: ['users'],
            },
        ],
        sameServer: true,
        estimatedRows: 15,
        warnings: [],
        crossDialect: false,
        sourceDialect: 'postgres',
        destinationDialect: 'postgres',
    } as unknown as TransferPlan;

}

mock.module('../../../../src/core/transfer/index.js', () => ({
    ...actualTransfer,
    getTransferPlan: vi.fn(async () => [makePlan(), null]),
    transferData: vi.fn(async (_src: Config, dest: Config, options: TransferOptions) => {

        transferDests.push(dest);
        transferCalls.push(options);

        return [
            {
                status: 'success',
                tables: [],
                totalRows: 0,
                durationMs: 0,
                fkChecksRestored: true,
            } as TransferResult,
            null,
        ];

    }),
}));

/**
 * A sqlite config at the given role. `db:reset` resolves deny/confirm/allow
 * across viewer/operator/admin (src/core/policy/matrix.ts), which is what
 * selects the blocked, type-to-confirm, and plain-confirm branches.
 */
function makeConfig(name: string, role: Role): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: role, mcp: role },
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
    } as unknown as Config;

}

/** Active (source) config is always admin; the destination is what varies. */
const sourceConfig = makeConfig('source', 'admin');

let destConfig = makeConfig('dest', 'admin');

const createMockStateManager = () => ({
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn().mockReturnValue(sourceConfig),
    getActiveConfigName: vi.fn().mockReturnValue('source'),
    listConfigs: vi.fn(() => [sourceConfig, destConfig]),
    getConfig: vi.fn((name: string) => (name === 'dest' ? destConfig : sourceConfig)),
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

/**
 * Drives global dry-run/force through the real context setters — the same
 * transition the global D/F hotkeys produce.
 */
function GlobalModeSetter({ dryRun }: { dryRun: boolean }): null {

    const { globalModes, toggleDryRun } = useAppContext();

    useEffect(() => {

        if (globalModes.dryRun !== dryRun) toggleDryRun();

    }, [globalModes, dryRun, toggleDryRun]);

    return null;

}

describe('cli: DbTransferScreen', () => {

    let tempDir: string;

    const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));

    function tree(dryRun = false) {

        return (
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ToastProvider>
                            <GlobalModeSetter dryRun={dryRun} />
                            <DbTransferScreen params={{}} />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>
        );

    }

    /**
     * Walks the screen to the confirm step: destination -> tables -> conflict
     * strategy -> plan. Returns the harness so each test can drive the
     * confirm branch itself.
     */
    async function advanceToConfirm(dryRun = false) {

        const harness = render(tree(dryRun));

        await tick(300);

        // select-dest: 'dest' is the first entry (active config is filtered out)
        harness.stdin.write('\r');
        await tick(300);

        return harness;

    }

    beforeEach(async () => {

        vi.clearAllMocks();
        actualCore.observer.clear();

        delete process.env['NOORM_YES'];

        transferCalls.length = 0;
        transferDests.length = 0;
        destConfig = makeConfig('dest', 'admin');
        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-transfer-test-'));

    });

    afterEach(async () => {

        actualCore.observer.clear();

        await rm(tempDir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../../src/core/transfer/index.js', () => actualTransfer);

    });

    describe('destination policy gate', () => {

        it('should refuse a destination whose role denies db:reset', async () => {

            destConfig = makeConfig('dest', 'viewer');

            const { lastFrame, unmount } = await advanceToConfirm();

            const frame = lastFrame() ?? '';

            // Denied at selection time, not after walking the whole wizard.
            expect(frame).toContain('not allowed');
            expect(frame).not.toContain('Select Tables');

            unmount();

            expect(transferCalls).toHaveLength(0);

        });

        it('should require the typed phrase for a confirm-tier destination', async () => {

            destConfig = makeConfig('dest', 'operator');

            const { stdin, lastFrame, unmount } = await advanceToConfirm();

            stdin.write('\r');       // select-tables -> options (all tables)
            await tick();
            stdin.write(DOWN);       // past the truncate toggle
            await tick();
            stdin.write('\r');       // options -> plan ('fail' strategy)
            await tick(300);
            stdin.write('\r');       // plan -> confirm
            await tick();

            expect(lastFrame() ?? '').toContain('Protected Configuration');

            // A bare 'y' is what used to execute; it must not any more.
            stdin.write('y');
            await tick(300);

            unmount();

            expect(transferCalls).toHaveLength(0);

        });

        it('should transfer after the confirmation phrase is typed', async () => {

            destConfig = makeConfig('dest', 'operator');

            const { stdin, unmount } = await advanceToConfirm();

            stdin.write('\r');
            await tick();
            stdin.write(DOWN);
            await tick();
            stdin.write('\r');
            await tick(300);
            stdin.write('\r');
            await tick();

            stdin.write('yes-dest');
            await tick();
            stdin.write('\r');
            await tick(300);

            unmount();

            expect(transferCalls).toHaveLength(1);
            expect(transferDests[0]?.name).toBe('dest');

        });

        it('should gate against the destination, not the active config', async () => {

            // Source is admin, destination is viewer. Gating the active config
            // would let this through — the exact bug. Walk the whole wizard so
            // a gate that only fires at selection time is not the only thing
            // keeping this green.
            destConfig = makeConfig('dest', 'viewer');

            const { stdin, unmount } = await advanceToConfirm();

            stdin.write('\r');
            await tick();
            stdin.write(DOWN);
            await tick();
            stdin.write('\r');
            await tick(300);
            stdin.write('\r');
            await tick();
            stdin.write('y');
            await tick(300);

            unmount();

            expect(transferCalls).toHaveLength(0);

        });

    });

    describe('option wiring', () => {

        /** Walks an admin destination all the way through the plain confirm. */
        async function runTransfer(dryRun = false, toggleTruncate = false) {

            const { stdin, unmount } = await advanceToConfirm(dryRun);

            stdin.write('\r');       // tables
            await tick();

            // The options list opens on the truncate toggle row; Enter there
            // flips it and stays put, so the cursor must then move down to a
            // conflict strategy to advance.
            if (toggleTruncate) {

                stdin.write('\r');
                await tick();

            }

            stdin.write(DOWN);       // move off the toggle onto 'Fail on conflict'
            await tick();
            stdin.write('\r');       // conflict strategy
            await tick(300);
            stdin.write('\r');       // plan -> confirm
            await tick();
            stdin.write('y');        // admin => plain Confirm
            await tick(300);

            unmount();

            expect(transferCalls).toHaveLength(1);

            return transferCalls[0];

        }

        it('should pass dryRun: true when global dry-run is on', async () => {

            const options = await runTransfer(true);

            expect(options?.dryRun).toBe(true);

        });

        it('should pass dryRun: false when global dry-run is off', async () => {

            const options = await runTransfer(false);

            expect(options?.dryRun).toBe(false);

        });

        it('should default truncateFirst to false', async () => {

            const options = await runTransfer();

            expect(options?.truncateFirst).toBe(false);

        });

        it('should pass truncateFirst: true once the truncate option is toggled on', async () => {

            const options = await runTransfer(false, true);

            expect(options?.truncateFirst).toBe(true);

        });

    });

});

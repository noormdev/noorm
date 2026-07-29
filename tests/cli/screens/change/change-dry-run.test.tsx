/**
 * ChangeFFScreen global-mode wiring tests.
 *
 * The TUI exposes global dry-run/force toggles (`useAppContext().globalModes`,
 * rendered as the bold yellow "DRY" badge in src/tui/app.tsx). Every change
 * screen used to call the ChangeManager with no options at all, so a user
 * could toggle dry-run, see the badge, confirm a fast-forward, and have it
 * applied for real against the database -- the TUI twin of the `--dry-run`
 * CLI defect.
 *
 * Drives the real screen through the real providers rather than asserting on
 * source text. A helper component flips the modes through
 * `toggleDryRun`/`toggleForce` only once the screen is already sitting on the
 * confirm step -- the same order a user hits the global D/F hotkeys in. That
 * ordering is what covers the `useCallback` dependency half of the fix:
 * `exhaustive-deps` is not enabled in eslint.config.js, and by confirm time
 * every other dep (`pendingChanges` in particular) has settled, so a
 * `handleRun` missing `globalModes` from its deps hands back its cached
 * all-false closure and these tests go red.
 *
 * `ChangeManager` is subclassed and swapped in via `mock.module` (the
 * precedent from tests/cli/utils/change-context.test.ts) so `ff()` records the
 * options object it was handed instead of touching a database.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React, { useEffect } from 'react';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BatchChangeOptions, BatchChangeResult } from '../../../../src/core/change/types.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider, useAppContext } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ChangeFFScreen } from '../../../../src/tui/screens/change/ChangeFFScreen.js';
import { resetLockManager } from '../../../../src/core/lock/index.js';

// Pre-import actual modules for restoration
const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualManagerModule = await import('../../../../src/core/change/manager.js');

/** Options object handed to `ff()` on each invocation. */
const ffCalls: BatchChangeOptions[] = [];

/**
 * Records the `ff()` options and short-circuits execution.
 *
 * `ChangeManager` keeps its context in a true private (`#context`) field and
 * the screen never exposes the manager it built, so swapping the exported
 * class is the only way to observe the call.
 */
class SpyChangeManager extends actualManagerModule.ChangeManager {

    override async ff(options: BatchChangeOptions = {}): Promise<BatchChangeResult> {

        ffCalls.push(options);

        return {
            status: 'success',
            changes: [],
            executed: 1,
            skipped: 0,
            failed: 0,
            durationMs: 0,
        };

    }

}

/**
 * A sqlite config the `change:ff` policy allows outright (admin), so the
 * screen renders the plain yes/no Confirm rather than the type-to-confirm
 * ProtectedConfirm branch.
 */
function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, mcp: 'admin' as const },
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
    listConfigs: vi.fn().mockReturnValue([]),
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

// Mutable so each test can swap in a fresh fixture; the mock.module factory
// closures read these at call time (matches ConfigRemoveScreen.test.tsx).
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

mock.module('../../../../src/core/change/manager.js', () => ({
    ...actualManagerModule,
    ChangeManager: SpyChangeManager,
}));

/**
 * Drives the global modes to the requested state through the real context
 * setters — the same state transition the global D/F hotkeys produce.
 */
function GlobalModeSetter({ dryRun, force }: { dryRun: boolean; force: boolean }): null {

    const { globalModes, toggleDryRun, toggleForce } = useAppContext();

    useEffect(() => {

        if (globalModes.dryRun !== dryRun) toggleDryRun();
        if (globalModes.force !== force) toggleForce();

    }, [globalModes, dryRun, force, toggleDryRun, toggleForce]);

    return null;

}

describe('cli: ChangeFFScreen global modes', () => {

    let tempDir: string;

    /**
     * The screen under its real provider stack, with the modes the
     * `GlobalModeSetter` should drive the context to.
     */
    function tree(modes: { dryRun: boolean; force: boolean }) {

        return (
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                        <ToastProvider>
                            <GlobalModeSetter dryRun={modes.dryRun} force={modes.force} />
                            <ChangeFFScreen params={{}} />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>
        );

    }

    /**
     * Mounts the screen with both modes off, toggles to the requested modes
     * once it reaches the confirm step, confirms, and returns the options
     * `ff()` received.
     */
    async function runFastForward(modes: { dryRun: boolean; force: boolean }) {

        const { stdin, lastFrame, rerender, unmount } = render(
            tree({ dryRun: false, force: false }),
        );

        // Change discovery + history lookup are async; the screen only reaches
        // the confirm step (and only then accepts 'y') once both settle.
        await new Promise((r) => setTimeout(r, 300));

        expect(lastFrame()).toContain('Apply all pending changes?');

        // Toggle here, not at mount: every other `handleRun` dependency has
        // settled by now, so `globalModes` is the only thing that can
        // invalidate the memoized callback.
        rerender(tree(modes));

        await new Promise((r) => setTimeout(r, 100));

        stdin.write('y');

        await new Promise((r) => setTimeout(r, 300));

        unmount();

        expect(ffCalls).toHaveLength(1);

        return ffCalls[0];

    }

    beforeEach(async () => {

        vi.clearAllMocks();
        resetLockManager();
        actualCore.observer.clear();

        ffCalls.length = 0;
        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-ff-modes-test-'));

        // A real pending change on disk: the screen refuses to fast-forward
        // template-only or empty changes before it ever builds a manager.
        const changeDir = join(tempDir, 'changes', 'add-widgets-table', 'change');

        await mkdir(changeDir, { recursive: true });
        await mkdir(join(tempDir, 'sql'), { recursive: true });
        await writeFile(
            join(changeDir, '001.sql'),
            'CREATE TABLE widgets (id INTEGER PRIMARY KEY)',
        );

    });

    afterEach(async () => {

        resetLockManager();
        actualCore.observer.clear();

        await rm(tempDir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../../../src/core/index.js', () => actualCore);
        mock.module('../../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../../src/core/change/manager.js', () => actualManagerModule);

    });

    it('should pass dryRun: true to ChangeManager.ff when global dry-run is on', async () => {

        const options = await runFastForward({ dryRun: true, force: false });

        expect(options?.dryRun).toBe(true);

    });

    it('should pass force: true to ChangeManager.ff when global force is on', async () => {

        const options = await runFastForward({ dryRun: false, force: true });

        expect(options?.force).toBe(true);

    });

    it('should pass both modes as false to ChangeManager.ff when neither toggle is on', async () => {

        const options = await runFastForward({ dryRun: false, force: false });

        // Not `toBeFalsy()`: an omitted options object would satisfy that while
        // leaving the manager on its own defaults, which is the regression.
        expect(options).toEqual({ dryRun: false, force: false });

    });

    it('should carry both modes through together when dry-run and force are on', async () => {

        const options = await runFastForward({ dryRun: true, force: true });

        expect(options).toEqual({ dryRun: true, force: true });

    });

});

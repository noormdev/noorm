/**
 * ChangeListScreen windowing tests: the frame fits the terminal whatever the
 * change count, and the arrow keys reach every change. Changes are real folders
 * scanned against a real sqlite database, so the row count is what a project loads.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { ChangeListScreen } from '../../../../src/tui/screens/change/ChangeListScreen.js';

const actualCore = await import('../../../../src/core/index.js');
const actualIdentity = await import('../../../../src/core/identity/index.js');

/** Rows the app shell takes outside the screen: breadcrumb, status bar, and their rules. */
const SHELL_ROWS = 4;

/** More changes than either terminal size under test can hold, so the list must window. */
const CHANGE_COUNT = 40;

/** Property descriptors to put back, so a pinned size cannot leak to the next file. */
const originalStdout = {
    columns: Object.getOwnPropertyDescriptor(process.stdout, 'columns'),
    rows: Object.getOwnPropertyDescriptor(process.stdout, 'rows'),
};

let database = '';

function makeConfig() {

    return {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        access: { user: 'admin' as const, agent: 'admin' as const },
        connection: { dialect: 'sqlite' as const, database },
    };

}

const mockStateManager = {
    load: vi.fn().mockResolvedValue(undefined),
    getActiveConfig: vi.fn(() => makeConfig()),
    getActiveConfigName: vi.fn().mockReturnValue('test'),
    listConfigs: vi.fn(() => [makeConfig()]),
    getConfig: vi.fn(() => makeConfig()),
    setConfig: vi.fn().mockResolvedValue(undefined),
    setActiveConfig: vi.fn().mockResolvedValue(undefined),
    hasPrivateKey: vi.fn().mockReturnValue(true),
    isLoaded: true,
};

const mockSettingsManager = {
    load: vi.fn().mockResolvedValue({ version: '0.1.0' }),
    isLoaded: true,
    settings: { version: '0.1.0' },
    getStages: vi.fn().mockReturnValue({}),
    getStage: vi.fn().mockReturnValue(undefined),
};

mock.module('../../../../src/core/index.js', () => ({
    ...actualCore,
    getStateManager: vi.fn(() => mockStateManager),
    getSettingsManager: vi.fn(() => mockSettingsManager),
    resetStateManager: vi.fn(),
    resetSettingsManager: vi.fn(),
}));

mock.module('../../../../src/core/identity/index.js', () => ({
    ...actualIdentity,
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const plain = (frame: string | undefined) => (frame ?? '').replace(/\x1B\[[0-9;]*m/g, '');

/**
 * Poll rather than sleep a guessed duration: a fixed wait is the suite's known
 * flake class under load.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate()) {

        if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** Change folder name for index `i`, one day apart so the sort order is fixed. */
function changeName(i: number): string {

    const day = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

    return `${day}-change-${String(i).padStart(2, '0')}`;

}

describe('cli: ChangeListScreen windowing', () => {

    let projectRoot: string;

    beforeEach(async () => {

        projectRoot = await mkdtemp(join(tmpdir(), 'noorm-change-list-'));
        database = join(projectRoot, 'test.db');

        for (let i = 0; i < CHANGE_COUNT; i++) {

            const changeDir = join(projectRoot, 'db', 'changes', changeName(i), 'change');
            await mkdir(changeDir, { recursive: true });
            await writeFile(join(changeDir, '001_step.sql'), 'SELECT 1;');

        }

    });

    afterEach(async () => {

        // `process.stdout` usually has no own `rows`/`columns`, and leaving the
        // pinned ones behind hands this terminal size to every later file.
        for (const [key, descriptor] of Object.entries(originalStdout)) {

            if (descriptor) {

                Object.defineProperty(process.stdout, key, descriptor);

            }
            else {

                Reflect.deleteProperty(process.stdout, key);

            }

        }

        await rm(projectRoot, { recursive: true, force: true });

    });

    /**
     * Render the screen into a terminal `rows` high.
     *
     * Both dimensions are pinned because `terminal-size` only trusts
     * `process.stdout` when both are set.
     */
    function open(rows: number) {

        Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });
        Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });

        return render(
            <FocusProvider>
                <RouterProvider>
                    <AppContextProvider projectRoot={projectRoot} autoLoad={true}>
                        <ToastProvider>
                            <ChangeListScreen params={{}} />
                        </ToastProvider>
                    </AppContextProvider>
                </RouterProvider>
            </FocusProvider>,
        );

    }

    /**
     * Wait until the loaded frame fits the rows the shell leaves the screen.
     *
     * The hint row is measured, and the detail box appears once the list reports
     * its first highlight, so the early frames differ from the one the screen
     * settles on. `mustShow` names text that only the settled frame carries.
     */
    async function waitToFit(lastFrame: () => string | undefined, rows: number, mustShow = '[Esc] Back'): Promise<string> {

        await waitFor(() => {

            const frame = plain(lastFrame());

            return frame.includes(`Total: ${CHANGE_COUNT}`)
                && frame.includes(mustShow)
                && frame.split('\n').length <= rows - SHELL_ROWS;

        });

        return plain(lastFrame());

    }

    it('should fit the terminal and keep the hotkey hints on screen when changes outnumber the rows', async () => {

        const { lastFrame, unmount } = open(30);

        const frame = await waitToFit(lastFrame, 30, 'Revert files');
        unmount();

        expect(frame).toContain('[Esc] Back');
        expect(frame).toContain(changeName(CHANGE_COUNT - 1));
        expect(frame).toMatch(/↓ \d+ more/);

    }, 20_000);

    it('should still fit a 24-row terminal, where the detail box no longer has room', async () => {

        const { lastFrame, unmount } = open(24);

        await waitToFit(lastFrame, 24);

        // A fixed wait is the only way to show something does not appear: the
        // detail box would land on the render after the list's first highlight.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const frame = plain(lastFrame());
        unmount();

        expect(frame.split('\n').length).toBeLessThanOrEqual(24 - SHELL_ROWS);
        expect(frame).not.toContain('Revert files');
        expect(frame).toContain('[Esc] Back');
        expect(frame).toContain(changeName(CHANGE_COUNT - 1));
        expect(frame).toMatch(/↓ \d+ more/);

    }, 20_000);

    it('should scroll the last change into view when the cursor walks down to it', async () => {

        const { stdin, lastFrame, unmount } = open(30);

        await waitToFit(lastFrame, 30, 'Revert files');

        for (let i = 0; i < CHANGE_COUNT - 1; i++) {

            stdin.write('\x1B[B');
            await new Promise((resolve) => setTimeout(resolve, 5));

        }

        const oldest = changeName(0);
        await waitFor(() => plain(lastFrame()).includes(`❯ ○ ${oldest}`));
        const frame = await waitToFit(lastFrame, 30);
        unmount();

        expect(frame).not.toContain(changeName(CHANGE_COUNT - 1));
        expect(frame).toMatch(/↑ \d+ more/);
        expect(frame).toContain('[Esc] Back');

    }, 20_000);

});

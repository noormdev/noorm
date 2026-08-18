/**
 * ChangeAddScreen mouse-report regression.
 *
 * `@inkjs/ui`'s `TextInput` ends its `useInput` handler with an unconditional
 * `state.insert(input)`, and Ink hands every registered handler every keystroke
 * — including the SGR mouse reports the transport asks the terminal for. A
 * click landed while a field was in edit mode typed the raw report into the
 * field.
 *
 * This screen is why that is not cosmetic. The description feeds a derived
 * value: `toKebabCase(name)` becomes the change folder name, and that folder is
 * created on disk. A stray click while typing produced
 * `2026-08-17-0-20-11m-0-20-11m-0-20-11m` as a real directory. So the case
 * pinned here is a *derived* field, not a bare input, and it drives both
 * terminators — a press (`M`) and a release (`m`) — because one gesture emits
 * both and a guard that only matched `M` would catch half of them.
 *
 * Drives the real screen through its real providers. The state manager is
 * swapped with `mock.module` (the precedent from `change-dry-run.test.tsx` in
 * this directory) purely so `activeConfig` is non-null and the screen reaches
 * its input step; nothing here touches a database.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { RouterProvider } from '../../../../src/tui/router.js';
import { AppContextProvider } from '../../../../src/tui/app-context.js';
import { ToastProvider } from '../../../../src/tui/components/index.js';
import { MouseProvider, MOUSE_ENABLE, MOUSE_DISABLE } from '../../../../src/tui/mouse.js';
import { ChangeAddScreen } from '../../../../src/tui/screens/change/ChangeAddScreen.js';

const actualCore = await import('../../../../src/core/index.js');

const ESC = String.fromCharCode(27);

/** SGR press report. Column and row are 1-based, the way a terminal sends them. */
const press = (row: number, column = 1) => `${ESC}[<0;${column};${row}M`;

/** SGR release report — same shape, lowercase terminator. */
const release = (row: number, column = 1) => `${ESC}[<0;${column};${row}m`;

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function strip(frame: string): string {

    return frame.replace(ANSI_PATTERN, '');

}

/** The frames the UI drew, minus the transport's own escape-sequence writes. */
const lastUi = (frames: string[]) => strip(
    frames.filter((f) => f !== MOUSE_ENABLE && f !== MOUSE_DISABLE).at(-1) ?? '',
);

function lineWith(frame: string, needle: string): string {

    return frame.split('\n').find((line) => line.includes(needle))?.trimEnd() ?? '';

}

/**
 * What the screen shows after a label, with the panel border and the trailing
 * cursor cell taken off.
 */
function fieldValue(frame: string, label: string): string {

    const line = lineWith(frame, label);

    return line.slice(line.indexOf(label) + label.length).replace(/│\s*$/, '').trim();

}

function terminalRowOf(frame: string, needle: string): number {

    const index = frame.split('\n').findIndex((line) => line.includes(needle));

    if (index < 0) throw new Error(`"${needle}" is not in the frame:\n${frame}`);

    return index + 1;

}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

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

describe('cli: ChangeAddScreen with the mouse on', () => {

    let tempDir: string;

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-change-add-mouse-'));
        mockStateManager = createMockStateManager();
        mockSettingsManager = createMockSettingsManager();

    });

    afterEach(async () => {

        await rm(tempDir, { recursive: true, force: true });

    });

    function tree() {

        return (
            <MouseProvider enabled={true}>
                <FocusProvider>
                    <RouterProvider>
                        <AppContextProvider projectRoot={tempDir} autoLoad={true}>
                            <ToastProvider>
                                <ChangeAddScreen params={{}} />
                            </ToastProvider>
                        </AppContextProvider>
                    </RouterProvider>
                </FocusProvider>
            </MouseProvider>
        );

    }

    it('should leave the description and its derived folder untouched when a click lands mid-typing', async () => {

        const { stdin, frames, unmount } = render(tree());

        await waitFor(() => lastUi(frames).includes('Description:'));
        await tick();

        stdin.write('Add user roles');
        await waitFor(() => lastUi(frames).includes('add-user-roles'));

        const row = terminalRowOf(lastUi(frames), 'Description:');

        // One gesture emits a press and a release, and a second press follows
        // it inside the double-click window. The captured defect showed all
        // three landing in the field.
        stdin.write(press(row, 20));
        await tick();
        stdin.write(release(row, 20));
        await tick();
        stdin.write(press(row, 20));
        await tick();

        const frame = lastUi(frames);

        expect(fieldValue(frame, 'Description:')).toBe('Add user roles');
        expect(fieldValue(frame, 'Folder:')).toMatch(/^\d{4}-\d{2}-\d{2}-add-user-roles$/);
        expect(frame).not.toContain('[<');

        unmount();
        await tick();

    });

    it('should still accept typing after a click', async () => {

        const { stdin, frames, unmount } = render(tree());

        await waitFor(() => lastUi(frames).includes('Description:'));
        await tick();

        stdin.write('Add user');
        await waitFor(() => lastUi(frames).includes('add-user'));

        const row = terminalRowOf(lastUi(frames), 'Description:');

        stdin.write(press(row, 20));
        await tick();
        stdin.write(release(row, 20));
        await tick();

        stdin.write(' roles');
        await waitFor(() => lastUi(frames).includes('add-user-roles'));

        const frame = lastUi(frames);

        expect(fieldValue(frame, 'Description:')).toBe('Add user roles');
        expect(fieldValue(frame, 'Folder:')).toMatch(/^\d{4}-\d{2}-\d{2}-add-user-roles$/);

        unmount();
        await tick();

    });

});

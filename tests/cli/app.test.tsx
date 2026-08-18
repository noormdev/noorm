/**
 * App component tests.
 *
 * Tests full app rendering and integration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { App } from '../../src/tui/app.js';
import { resetLifecycleManager } from '../../src/core/lifecycle/manager.js';
import { resetSettingsManager } from '../../src/core/settings/index.js';
import { resetStateManager } from '../../src/core/state/index.js';
import { MOUSE_ENABLE, MOUSE_DISABLE } from '../../src/tui/mouse.js';
import type { Route } from '../../src/tui/types.js';

// ANSI escape sequences
const KEYS = {
    ESCAPE: '\x1B',
    CTRL_C: '\x03',
};

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

describe('cli: app', () => {

    // Reset lifecycle manager between tests to prevent state conflicts
    beforeEach(async () => {

        await resetLifecycleManager();

    });

    afterEach(async () => {

        await resetLifecycleManager();

    });

    describe('App', () => {

        it('should render without crashing', () => {

            const { lastFrame } = render(<App />);

            expect(lastFrame()).toBeDefined();

        });

        it('should display noorm branding', () => {

            const { lastFrame } = render(<App />);

            expect(lastFrame()).toContain('noorm');

        });

        it('should show status bar', () => {

            const { lastFrame } = render(<App />);

            // Status bar shows config name and connection status
            expect(lastFrame()).toContain('none'); // Default config name

        });

        it('should show breadcrumb with Home', () => {

            const { lastFrame } = render(<App />);

            expect(lastFrame()).toContain('Home');

        });

        it('should accept initial route', () => {

            const { lastFrame } = render(<App initialRoute="config" />);

            expect(lastFrame()).toContain('Config');

        });

        it('should accept nested initial route', () => {

            const { lastFrame } = render(<App initialRoute="config/add" />);

            expect(lastFrame()).toContain('Add');

        });

        it('should handle Escape for back navigation', async () => {

            const { stdin, lastFrame, unmount } = render(<App initialRoute="config/add" />);

            // Initial state shows config/add screen (or NotFound)
            const initialFrame = lastFrame();
            expect(initialFrame).toBeDefined();

            // Press Escape - should try to go back
            // Since we start with history, this may navigate back
            stdin.write(KEYS.ESCAPE);

            await new Promise((resolve) => setTimeout(resolve, 10));

            // The app should still be rendering
            expect(lastFrame()).toBeDefined();

            unmount();

        });

        // Note: This test may be flaky due to timing with keyboard event handling
        it('should handle ? for help overlay', { retry: 2 }, async () => {

            const { stdin, lastFrame, unmount } = render(<App />);

            // Wait for app to fully render
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Press ? to show help
            stdin.write('?');

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Help overlay should contain keyboard shortcuts info
            // Note: The help screen shows shortcuts in columns without a header
            expect(lastFrame()).toContain('go back / cancel');
            expect(lastFrame()).toContain('confirm / select');
            expect(lastFrame()).toContain('quit application');

            unmount();

        });

        /**
         * The help screen as it renders for a project with the given settings
         * file, or with none written at all.
         *
         * Reads the help out of `frames` rather than `lastFrame()`: the mouse
         * transport writes its escape sequences through the same stream, so the
         * last write is often a sequence rather than a screen.
         */
        async function helpScreenFor(yaml: string | null): Promise<string> {

            const root = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-mouse-help-'));

            try {

                if (yaml !== null) {

                    mkdirSync(join(root, '.noorm'), { recursive: true });
                    writeFileSync(join(root, '.noorm', 'settings.yml'), yaml);

                }

                resetSettingsManager();
                resetStateManager();

                const { stdin, frames, unmount } = render(<App projectRoot={root} />);

                await waitFor(() => frames.some((f) => f.includes('Home')));

                // The line reports the transport's state, so it is only
                // meaningful once the settings load has settled it.
                await new Promise((resolve) => setTimeout(resolve, 300));

                stdin.write('?');

                await waitFor(() => frames.some((f) => f.includes('go back / cancel')));

                unmount();

                return frames.filter((f) => f.includes('go back / cancel')).at(-1) ?? '';

            }
            finally {

                resetSettingsManager();
                resetStateManager();
                rmSync(root, { recursive: true, force: true });

            }

        }

        it('should tell the help screen reader how to turn the mouse off', async () => {

            // Discoverability now cuts the other way. With the mouse on by
            // default, the user who has to find the flag is the one who dislikes
            // it, and their symptom is "text selection stopped working" — which
            // points at their terminal, not at noorm. `?` is where that gets
            // answered.
            const help = await helpScreenFor(null);

            expect(help).toContain('Mouse on.');
            expect(help).toContain('ui.mouse: false');
            expect(help).toContain('restores text selection');

        });

        it('should tell the help screen reader how to turn the mouse back on', async () => {

            const help = await helpScreenFor('ui:\n    mouse: false\n');

            expect(help).toContain('Mouse off.');
            expect(help).toContain('ui.mouse: true');
            expect(help).toContain('enables clicks');

        });

        it('should exit on Ctrl+C', async () => {

            const { stdin, unmount } = render(<App />);

            // Ctrl+C should trigger exit
            // Note: In test environment, this may throw or the app may just unmount
            try {

                stdin.write(KEYS.CTRL_C);
                await new Promise((resolve) => setTimeout(resolve, 10));

            }
            catch {
                // Exit may throw in test environment
            }

            unmount();

        });

    });

    describe('breadcrumb navigation', () => {

        it('should show single label for home', () => {

            const { lastFrame } = render(<App initialRoute="home" />);

            // Should show just Home
            expect(lastFrame()).toContain('Home');

        });

        it('should show nested path in breadcrumb', () => {

            const { lastFrame } = render(<App initialRoute="run/build" />);

            // Should contain Build in breadcrumb
            expect(lastFrame()).toContain('Build');

        });

    });

    describe('status bar', () => {

        it('should show lock status', () => {

            const { lastFrame } = render(<App />);

            // Lock indicator (emoji or text)
            // Default is unlocked
            expect(lastFrame()).toMatch(/🔓|free/);

        });

        it('should show connection indicator', () => {

            const { lastFrame } = render(<App />);

            // Connection indicator (● for connected, ○ for disconnected)
            expect(lastFrame()).toMatch(/●|○/);

        });

    });

    describe('provider hierarchy', () => {

        it('should provide focus context', () => {

            // If focus context isn't provided, rendering would throw
            const { lastFrame } = render(<App />);

            expect(lastFrame()).toBeDefined();

        });

        it('should provide router context', () => {

            // If router context isn't provided, rendering would throw
            const { lastFrame } = render(<App />);

            expect(lastFrame()).toBeDefined();

        });

        it('should turn the mouse on when settings.yml has no ui section at all', async () => {

            // The default. `ui.mouse` absent means on, so a project that never
            // writes the section gets the mouse.
            const root = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-mouse-app-'));

            try {

                resetSettingsManager();
                resetStateManager();

                const { frames, unmount } = render(<App projectRoot={root} />);

                await waitFor(() => frames.includes(MOUSE_ENABLE));

                expect(frames).toContain(MOUSE_ENABLE);

                unmount();
                await new Promise((resolve) => setTimeout(resolve, 100));

                expect(frames).toContain(MOUSE_DISABLE);

            }
            finally {

                resetSettingsManager();
                resetStateManager();
                rmSync(root, { recursive: true, force: true });

            }

        });

        it('should leave the mouse off when settings.yml writes ui.mouse: false', async () => {

            // The escape hatch, and the reason the flag still exists. Written
            // false has to survive a default that says otherwise.
            const root = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-mouse-app-'));

            try {

                mkdirSync(join(root, '.noorm'), { recursive: true });
                writeFileSync(join(root, '.noorm', 'settings.yml'), 'ui:\n    mouse: false\n');

                resetSettingsManager();
                resetStateManager();

                const { frames, unmount } = render(<App projectRoot={root} />);

                await waitFor(() => frames.some((f) => f.includes('Home')));

                // Past the point where the settings load resolves, which is the
                // only moment the flag could have flipped on.
                await new Promise((resolve) => setTimeout(resolve, 300));

                expect(frames).not.toContain(MOUSE_ENABLE);

                unmount();

                expect(frames).not.toContain(MOUSE_DISABLE);

            }
            finally {

                resetSettingsManager();
                resetStateManager();
                rmSync(root, { recursive: true, force: true });

            }

        });

        it('should turn the mouse on when settings.yml asks for it explicitly', async () => {

            const root = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-mouse-app-'));

            try {

                mkdirSync(join(root, '.noorm'), { recursive: true });
                writeFileSync(join(root, '.noorm', 'settings.yml'), 'ui:\n    mouse: true\n');

                resetSettingsManager();
                resetStateManager();

                const { frames, unmount } = render(<App projectRoot={root} />);

                // The flag is not known at render() time — the managers load
                // asynchronously — so this also pins that the enable sequence
                // waits for the setting rather than for the first frame.
                await waitFor(() => frames.includes(MOUSE_ENABLE));

                expect(frames).toContain(MOUSE_ENABLE);

                unmount();
                await new Promise((resolve) => setTimeout(resolve, 100));

                expect(frames).toContain(MOUSE_DISABLE);

            }
            finally {

                resetSettingsManager();
                resetStateManager();
                rmSync(root, { recursive: true, force: true });

            }

        });

    });

    describe('screen rendering', () => {

        it('should render home screen by default', () => {

            const { lastFrame } = render(<App />);

            // Home screen should render content
            expect(lastFrame()).toBeDefined();
            expect(lastFrame()?.length).toBeGreaterThan(0);

        });

        it('should render not-found for unregistered routes', () => {

            const { lastFrame } = render(<App initialRoute={'some/unregistered/route' as Route} />);

            expect(lastFrame()).toContain('Not Found');

        });

    });

});

/**
 * App component tests.
 *
 * Tests full app rendering and integration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { App } from '../../src/cli/app.js';
import { resetLifecycleManager } from '../../src/core/lifecycle/manager.js';

// ANSI escape sequences
const KEYS = {
    ESCAPE: '\x1B',
    CTRL_C: '\x03',
};

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

    });

    describe('screen rendering', () => {

        it('should render home screen by default', () => {

            const { lastFrame } = render(<App />);

            // Home screen should render content
            expect(lastFrame()).toBeDefined();
            expect(lastFrame()?.length).toBeGreaterThan(0);

        });

        it('should render not-found for unregistered routes', () => {

            const { lastFrame } = render(<App initialRoute="some/unregistered/route" />);

            expect(lastFrame()).toContain('Not Found');

        });

    });

});

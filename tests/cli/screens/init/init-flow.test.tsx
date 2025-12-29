/**
 * Init flow integration tests.
 *
 * Tests the complete initialization flow from identity setup through project creation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { act } from 'react';
import React from 'react';
import { join } from 'path';
import { tmpdir } from 'os';

import { FocusProvider } from '../../../../src/cli/focus.js';
import { RouterProvider } from '../../../../src/cli/router.js';
import { AppContextProvider } from '../../../../src/cli/app-context.js';
import { InitScreen } from '../../../../src/cli/screens/init/InitScreen.js';

// Create a unique test directory for each test run
const _TEST_PROJECT_ROOT = join(tmpdir(), `noorm-test-${Date.now()}`);

// Track mock state
let mockNoormExists = false;
let mockHasKeyFiles = false;
let createdDirs: string[] = [];
let writtenFiles: string[] = [];

// Mock fs
vi.mock('fs', async () => {

    const actual = await vi.importActual('fs');

    return {
        ...actual,
        existsSync: vi.fn((path) => {

            if (typeof path === 'string') {

                if (path.includes('.noorm')) {

                    return mockNoormExists;

                }

                if (path.includes('.gitignore')) {

                    return false;

                }

            }

            return false;

        }),
        mkdirSync: vi.fn((path) => {

            createdDirs.push(path as string);

        }),
        writeFileSync: vi.fn((path) => {

            writtenFiles.push(path as string);

        }),
        readFileSync: vi.fn(() => ''),
        appendFileSync: vi.fn(),
    };

});

// Mock identity module
vi.mock('../../../../src/core/identity/index.js', async () => {

    const actual = await vi.importActual('../../../../src/core/identity/index.js');

    return {
        ...actual,
        hasKeyFiles: vi.fn(() => Promise.resolve(mockHasKeyFiles)),
        detectIdentityDefaults: vi.fn(() => ({
            name: 'Test User',
            email: 'test@example.com',
            machine: 'test-machine',
            os: 'darwin 24.5.0',
        })),
        createCryptoIdentity: vi.fn(() =>
            Promise.resolve({
                identity: {
                    identityHash: 'abc123',
                    name: 'Test User',
                    email: 'test@example.com',
                    publicKey: 'pubkey123',
                    machine: 'test-machine',
                    os: 'darwin 24.5.0',
                    createdAt: new Date().toISOString(),
                },
                keypair: {
                    publicKey: 'pubkey123',
                    privateKey: 'privkey123',
                },
            }),
        ),
    };

});

// Mock state manager - must be a proper class
vi.mock('../../../../src/core/state/manager.js', () => {

    return {
        StateManager: class MockStateManager {

            load = vi.fn(() => Promise.resolve());
            setIdentity = vi.fn(() => Promise.resolve());
            hasPrivateKey = vi.fn(() => true);

        },
    };

});

// Mock settings manager - must be a proper class
vi.mock('../../../../src/core/settings/manager.js', () => {

    return {
        SettingsManager: class MockSettingsManager {

            init = vi.fn(() => Promise.resolve());
            load = vi.fn(() => Promise.resolve());
            exists = vi.fn(() => Promise.resolve(false));
            isLoaded = true;
            settings = {};

        },
    };

});

/**
 * Wait for async effects.
 */
async function waitForEffects(ms = 50): Promise<void> {

    await act(async () => {

        await new Promise((r) => setTimeout(r, ms));

    });

}

/**
 * Test wrapper with all required providers.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return (
        <AppContextProvider autoLoad={false}>
            <RouterProvider>
                <FocusProvider>{children}</FocusProvider>
            </RouterProvider>
        </AppContextProvider>
    );

}

describe('cli: screens/init - flow integration', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        mockNoormExists = false;
        mockHasKeyFiles = false;
        createdDirs = [];
        writtenFiles = [];

    });

    afterEach(() => {

        vi.restoreAllMocks();

    });

    it('should transition from identity to project setup on form submission', async () => {

        mockNoormExists = false;
        mockHasKeyFiles = false;

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects(100);

        // Should show identity setup
        expect(lastFrame()).toContain('Welcome to noorm');

        // Press Enter to submit the pre-filled form
        stdin.write('\r');

        await waitForEffects(100);

        // Should now show project setup
        expect(lastFrame()).toContain('Initialize noorm');
        expect(lastFrame()).toContain('set up my first config');

        unmount();

    });

    it('should complete init flow when add config is selected', { retry: 2 }, async () => {

        mockNoormExists = false;
        mockHasKeyFiles = false;

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects(100);

        // Should show identity setup
        expect(lastFrame()).toContain('Welcome to noorm');

        // Press Enter to submit identity form
        stdin.write('\r');

        await waitForEffects(100);

        // Should show project setup
        expect(lastFrame()).toContain('Initialize noorm');

        // Press Enter to select "Add Config" (first option)
        stdin.write('\r');

        // Wait longer for async init operations
        await waitForEffects(500);

        // Should show creating progress or complete
        const frame = lastFrame();

        // Debug: Log the frame if test fails
        if (
            !(
                frame?.includes('Creating') ||
                frame?.includes('Initializing') ||
                frame?.includes('Complete') ||
                frame?.includes('success')
            )
        ) {

            console.log('DEBUG frame:', frame);

        }

        // Should either be in creating or complete state
        expect(
            frame?.includes('Creating') ||
                frame?.includes('Initializing') ||
                frame?.includes('Complete') ||
                frame?.includes('success'),
        ).toBe(true);

        unmount();

    });

    it('should complete init flow when skip config is selected', async () => {

        mockNoormExists = false;
        mockHasKeyFiles = false;

        const { stdin, lastFrame, unmount } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects(100);

        // Should show identity setup
        expect(lastFrame()).toContain('Welcome to noorm');

        // Press Enter to submit identity form
        stdin.write('\r');

        await waitForEffects(100);

        // Should show project setup
        expect(lastFrame()).toContain('Initialize noorm');

        // Press down arrow to move to "Skip" option
        stdin.write('\x1b[B');

        await waitForEffects(50);

        // Press Enter to select "Skip"
        stdin.write('\r');

        await waitForEffects(200);

        // Should show creating progress or complete
        const frame = lastFrame();

        expect(
            frame?.includes('Creating') ||
                frame?.includes('Initializing') ||
                frame?.includes('Complete') ||
                frame?.includes('success'),
        ).toBe(true);

        unmount();

    });

    it('should skip identity setup when identity already exists', async () => {

        mockNoormExists = false;
        mockHasKeyFiles = true; // Identity exists

        const { lastFrame, unmount } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects(100);

        // Should skip directly to project setup
        expect(lastFrame()).toContain('Initialize noorm');
        expect(lastFrame()).not.toContain('Welcome to noorm');

        unmount();

    });

});

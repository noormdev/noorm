/**
 * InitScreen component tests.
 *
 * Tests the main initialization flow screen.
 * Uses simplified mocks for file system and identity checks.
 */
import { describe, it, expect, vi, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/cli/focus.js';
import { RouterProvider } from '../../../../src/cli/router.js';
import { AppContextProvider } from '../../../../src/cli/app-context.js';
import { InitScreen } from '../../../../src/cli/screens/init/InitScreen.js';

// Track mock state
let mockNoormExists = false;
let mockHasKeyFiles = false;
let mockHasMetadata = false;

// Pre-import actual modules to avoid circular await inside mock.module
const actualFs = await import('fs');
const actualIdentity = await import('../../../../src/core/identity/index.js');
const actualStateManager = await import('../../../../src/core/state/manager.js');
const actualSettingsManager = await import('../../../../src/core/settings/manager.js');

// Mock fs - needs to be before imports
mock.module('fs', () => ({
    ...actualFs,
    existsSync: vi.fn((path) => {

        if (typeof path === 'string' && path.includes('.noorm')) {

            return mockNoormExists;

        }

        return false;

    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    appendFileSync: vi.fn(),
}));

// Mock identity module
mock.module('../../../../src/core/identity/index.js', () => ({
    hasKeyFiles: vi.fn(() => Promise.resolve(mockHasKeyFiles)),
    loadIdentityMetadata: vi.fn(() =>
        Promise.resolve(
            mockHasMetadata
                ? {
                    identityHash: 'abc123',
                    name: 'Test User',
                    email: 'test@example.com',
                    publicKey: 'pubkey123',
                    machine: 'test-machine',
                    os: 'darwin 24.5.0',
                    createdAt: new Date().toISOString(),
                }
                : null,
        ),
    ),
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
    loadExistingIdentity: vi.fn().mockResolvedValue(null),
}));

// Mock state manager
mock.module('../../../../src/core/state/manager.js', () => ({
    StateManager: vi.fn().mockImplementation(() => ({
        load: vi.fn(() => Promise.resolve()),
        setIdentity: vi.fn(() => Promise.resolve()),
        hasPrivateKey: vi.fn(() => true),
    })),
}));

// Mock settings manager
mock.module('../../../../src/core/settings/manager.js', () => ({
    SettingsManager: vi.fn().mockImplementation(() => ({
        init: vi.fn(() => Promise.resolve()),
        load: vi.fn(() => Promise.resolve()),
        exists: vi.fn(() => Promise.resolve(false)),
        isLoaded: true,
        settings: {},
    })),
}));

/**
 * Wait for async effects.
 */
async function waitForEffects(ms = 50): Promise<void> {

    await new Promise((r) => setTimeout(r, ms));

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

describe('cli: screens/init/InitScreen', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        mockNoormExists = false;
        mockHasKeyFiles = false;
        mockHasMetadata = false;

    });

    afterEach(() => {

        vi.restoreAllMocks();

    });

    // Restore mocked modules to prevent pollution of subsequent test files
    afterAll(() => {

        mock.module('fs', () => actualFs);
        mock.module('../../../../src/core/identity/index.js', () => actualIdentity);
        mock.module('../../../../src/core/state/manager.js', () => actualStateManager);
        mock.module('../../../../src/core/settings/manager.js', () => actualSettingsManager);

    });

    it('should show checking state initially', () => {

        const { lastFrame } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        expect(lastFrame()).toContain('Checking');

    });

    it('should transition to identity setup when no identity exists', async () => {

        mockNoormExists = false;
        mockHasKeyFiles = false;

        const { lastFrame } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Welcome to noorm');

    });

    it('should show already initialized warning when .noorm exists', async () => {

        mockNoormExists = true;
        mockHasKeyFiles = false;

        const { lastFrame } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Already Initialized');

    });

    it('should skip identity setup when identity exists', async () => {

        mockNoormExists = false;
        mockHasKeyFiles = true;
        mockHasMetadata = true; // Full identity requires both keys and metadata

        const { lastFrame } = render(
            <TestWrapper>
                <InitScreen params={{}} />
            </TestWrapper>,
        );

        await waitForEffects();

        // Should show project setup (not identity setup)
        expect(lastFrame()).toContain('Initialize noorm');

    });

    it('should bypass warning with force param', async () => {

        mockNoormExists = true;
        mockHasKeyFiles = true;
        mockHasMetadata = true; // Full identity requires both keys and metadata

        const { lastFrame } = render(
            <TestWrapper>
                <InitScreen params={{ force: true }} />
            </TestWrapper>,
        );

        await waitForEffects();

        // With force flag and existing identity, should show project setup
        expect(lastFrame()).toContain('Initialize noorm');

    });

});

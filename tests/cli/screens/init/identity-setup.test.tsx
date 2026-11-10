/**
 * IdentitySetup component tests.
 *
 * Tests the identity setup form for first-time initialization.
 */
import { describe, it, expect, vi, mock, beforeEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { IdentitySetup } from '../../../../src/tui/screens/init/IdentitySetup.js';

const actualIdentity = await import('../../../../src/core/identity/index.js');

// Copied by value: `mock.module` rewrites the namespace in place, so reading
// `actualIdentity.detectIdentityDefaults` afterwards hands back the mock.
const realDetectIdentityDefaults = actualIdentity.detectIdentityDefaults;

// Mock the identity module
mock.module('../../../../src/core/identity/index.js', () => ({
    detectIdentityDefaults: vi.fn(() => ({
        name: 'Test User',
        email: 'test@example.com',
        machine: 'test-machine',
        os: 'darwin 24.5.0',
    })),
}));

/**
 * Wait for effects to complete.
 */
async function waitForEffects(): Promise<void> {

    await new Promise((r) => setTimeout(r, 50));

}

/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

describe('cli: screens/init/IdentitySetup', () => {

    afterAll(() => {

        mock.module('../../../../src/core/identity/index.js', () => ({
            ...actualIdentity,
            detectIdentityDefaults: realDetectIdentityDefaults,
        }));

    });

    beforeEach(() => {

        vi.clearAllMocks();

    });

    it('should render welcome message', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Welcome to noorm');

    });

    it('should show identity purpose', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('audit trail');
        expect(lastFrame()).toContain('sharing configs');

    });

    it('should render name field', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Name');

    });

    it('should render email field', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Email');

    });

    it('should render machine field', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Machine');

    });

    it('should show auto-detected OS', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('darwin 24.5.0');
        expect(lastFrame()).toContain('auto-detected');

    });

    it('should not promise a new keypair, because an existing private key is kept', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).not.toContain('keypair');

    });

    it('should say why setup appeared and why the last attempt failed', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup
                    onComplete={() => {}}
                    onCancel={() => {}}
                    reason="Saving a config needs an identity."
                    error="Failed to write identity metadata"
                />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Saving a config needs an identity.');
        expect(lastFrame()).toContain('✘ Failed to write identity metadata');

    });

    it('should show Continue button', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('Continue');

    });

    it('should show required field indicators', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        // Required fields should have asterisk
        expect(lastFrame()).toContain('*');

    });

});

/**
 * IdentitySetup component tests.
 *
 * Tests the identity setup form for first-time initialization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { act } from 'react';
import React from 'react';

import { FocusProvider } from '../../../../src/cli/focus.js';
import { IdentitySetup } from '../../../../src/cli/screens/init/IdentitySetup.js';

// Mock the identity module
vi.mock('../../../../src/core/identity/index.js', () => ({
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

    await act(async () => {

        await new Promise((r) => setTimeout(r, 10));

    });

}

/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

describe('cli: screens/init/IdentitySetup', () => {

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

    it('should show keypair generation message', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <IdentitySetup onComplete={() => {}} onCancel={() => {}} />
            </TestWrapper>,
        );

        await waitForEffects();

        expect(lastFrame()).toContain('keypair');

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

/**
 * Tests for DismissableAlert component.
 *
 * Tests rendering, keyboard navigation, and preference persistence.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';

import { FocusProvider } from '../../../src/cli/focus.js';
import { DismissableAlert } from '../../../src/cli/components/feedback/DismissableAlert.js';

// Mock the global settings module
vi.mock('../../../src/core/update/global-settings.js', () => ({
    getDismissablePreference: vi.fn(),
    updateDismissablePreference: vi.fn(),
}));

import {
    getDismissablePreference,
    updateDismissablePreference,
} from '../../../src/core/update/global-settings.js';

function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

describe('cli: DismissableAlert', () => {

    beforeEach(() => {

        vi.clearAllMocks();
        // Default: show the alert (preference is 'ask')
        vi.mocked(getDismissablePreference).mockResolvedValue('ask');
        vi.mocked(updateDismissablePreference).mockResolvedValue();

    });

    afterEach(() => {

        vi.restoreAllMocks();

    });

    it('should render title and message', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test Alert"
                    message="This is a test message."
                    onConfirm={() => {}}
                    onDeny={() => {}}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        // Wait for preference check
        await new Promise((r) => setTimeout(r, 100));

        const frame = lastFrame();
        expect(frame).toContain('Test Alert');
        expect(frame).toContain('This is a test message.');

    });

    it('should render button labels', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    confirmText="Yes"
                    denyText="No"
                    laterText="Maybe"
                    onConfirm={() => {}}
                    onDeny={() => {}}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        const frame = lastFrame();
        expect(frame).toContain('Yes');
        expect(frame).toContain('No');
        expect(frame).toContain('Maybe');

    });

    it('should call onConfirm when Enter pressed on Confirm', async () => {

        const onConfirm = vi.fn();

        const { stdin, unmount } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    onConfirm={onConfirm}
                    onDeny={() => {}}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        // Press Enter (Confirm is selected by default)
        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 50));

        expect(onConfirm).toHaveBeenCalled();

        unmount();

    });

    it('should call onLater when Enter pressed on Later', async () => {

        const onLater = vi.fn();

        const { stdin, unmount } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    onConfirm={() => {}}
                    onDeny={() => {}}
                    onLater={onLater}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        // Press right arrow to select Later
        stdin.write('\x1b[C');
        await new Promise((r) => setTimeout(r, 50));

        // Press Enter
        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 50));

        expect(onLater).toHaveBeenCalled();

        unmount();

    });

    it('should call onDeny when Enter pressed on Deny', async () => {

        const onDeny = vi.fn();

        const { stdin, unmount } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    onConfirm={() => {}}
                    onDeny={onDeny}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        // Press right arrow twice to select Deny
        stdin.write('\x1b[C');
        await new Promise((r) => setTimeout(r, 30));
        stdin.write('\x1b[C');
        await new Promise((r) => setTimeout(r, 30));

        // Press Enter
        stdin.write('\r');
        await new Promise((r) => setTimeout(r, 50));

        expect(onDeny).toHaveBeenCalled();

        unmount();

    });

    it('should auto-confirm when preference is always', async () => {

        vi.mocked(getDismissablePreference).mockResolvedValue('always');

        const onConfirm = vi.fn();

        render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    onConfirm={onConfirm}
                    onDeny={() => {}}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        expect(onConfirm).toHaveBeenCalled();

    });

    it('should auto-deny when preference is never', async () => {

        vi.mocked(getDismissablePreference).mockResolvedValue('never');

        const onDeny = vi.fn();

        render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    onConfirm={() => {}}
                    onDeny={onDeny}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        expect(onDeny).toHaveBeenCalled();

    });

    it('should support number key shortcuts', async () => {

        const onConfirm = vi.fn();
        const onLater = vi.fn();
        const onDeny = vi.fn();

        const { stdin, unmount } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test1"
                    title="Test"
                    message="Message"
                    onConfirm={onConfirm}
                    onDeny={onDeny}
                    onLater={onLater}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        // Press '1' for Confirm
        stdin.write('1');
        await new Promise((r) => setTimeout(r, 50));

        expect(onConfirm).toHaveBeenCalled();

        unmount();

    });

    it('should show persist checkbox when allowPersist is true', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    allowPersist={true}
                    onConfirm={() => {}}
                    onDeny={() => {}}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        const frame = lastFrame();
        expect(frame).toContain("Don't ask again");

    });

    it('should hide persist checkbox when allowPersist is false', async () => {

        const { lastFrame } = render(
            <TestWrapper>
                <DismissableAlert
                    alertKey="test"
                    title="Test"
                    message="Message"
                    allowPersist={false}
                    onConfirm={() => {}}
                    onDeny={() => {}}
                    onLater={() => {}}
                />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 100));

        const frame = lastFrame();
        expect(frame).not.toContain("Don't ask again");

    });

});

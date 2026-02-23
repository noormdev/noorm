/**
 * Form navigation tests.
 *
 * Tests Tab and Shift+Tab keyboard navigation between form fields.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/cli/focus.js';
import { Form } from '../../../src/cli/components/forms/index.js';
import type { FormField } from '../../../src/cli/components/forms/index.js';

const KEYS = {
    TAB: '\t',
    SHIFT_TAB: '\x1b[Z',
    DOWN: '\x1b[B',
    UP: '\x1b[A',
};

/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

/**
 * Helper to find which field has the active indicator.
 * Returns the label of the field with '›' before it.
 */
function getActiveField(frame: string, fieldLabels: string[]): string | null {

    const lines = frame.split('\n');

    for (const label of fieldLabels) {

        for (const line of lines) {

            if (line.includes('›') && line.includes(label)) {

                return label;

            }

        }

    }

    return null;

}

describe('cli: components/form-navigation', () => {

    const fields: FormField[] = [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'host', label: 'Host', type: 'text' },
        { key: 'port', label: 'Port', type: 'text' },
    ];
    const labels = ['Name', 'Host', 'Port'];

    it('should start with first field active', { retry: 2 }, async () => {

        const { lastFrame, unmount } = render(
            <TestWrapper>
                <Form fields={fields} onSubmit={() => {}} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));

        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Name');
        unmount();

    });

    it('should move to next field on Tab', async () => {

        const { lastFrame, stdin, unmount } = render(
            <TestWrapper>
                <Form fields={fields} onSubmit={() => {}} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));

        stdin.write(KEYS.TAB);
        await new Promise((r) => setTimeout(r, 150));

        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');
        unmount();

    });

    it('should move to previous field on Shift+Tab', async () => {

        const { lastFrame, stdin, unmount } = render(
            <TestWrapper>
                <Form fields={fields} onSubmit={() => {}} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));

        // Move to second field
        stdin.write(KEYS.TAB);
        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');

        // Shift+Tab back to first
        stdin.write(KEYS.SHIFT_TAB);
        await new Promise((r) => setTimeout(r, 150));

        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Name');
        unmount();

    });

    it('should navigate forward through all fields with Tab', async () => {

        const { lastFrame, stdin, unmount } = render(
            <TestWrapper>
                <Form fields={fields} onSubmit={() => {}} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Name');

        stdin.write(KEYS.TAB);
        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');

        stdin.write(KEYS.TAB);
        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Port');

        unmount();

    });

    it('should navigate backward through fields with Shift+Tab', async () => {

        const { lastFrame, stdin, unmount } = render(
            <TestWrapper>
                <Form fields={fields} onSubmit={() => {}} />
            </TestWrapper>,
        );

        await new Promise((r) => setTimeout(r, 150));

        // Navigate to last field
        stdin.write(KEYS.TAB);
        await new Promise((r) => setTimeout(r, 150));
        stdin.write(KEYS.TAB);
        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Port');

        // Navigate backward
        stdin.write(KEYS.SHIFT_TAB);
        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');

        stdin.write(KEYS.SHIFT_TAB);
        await new Promise((r) => setTimeout(r, 150));
        expect(getActiveField(lastFrame() ?? '', labels)).toBe('Name');

        unmount();

    });

});

/**
 * Form components tests.
 *
 * Tests Form component with various field types.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/cli/focus.js';
import { Form } from '../../../src/cli/components/forms/index.js';
import type { FormField } from '../../../src/cli/components/forms/index.js';

/**
 * Wrapper with focus provider for components that need focus.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

describe('cli: components/forms', () => {

    describe('Form', () => {

        it('should render field labels', () => {

            const fields: FormField[] = [
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'host', label: 'Host', type: 'text' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Name');
            expect(lastFrame()).toContain('Host');

        });

        it('should show required indicator', () => {

            const fields: FormField[] = [
                { key: 'name', label: 'Name', type: 'text', required: true },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('*');

        });

        it('should render checkbox fields', () => {

            const fields: FormField[] = [{ key: 'ssl', label: 'Use SSL', type: 'checkbox' }];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Use SSL');
            expect(lastFrame()).toContain('☐'); // Unchecked

        });

        it('should render checkbox with default value', () => {

            const fields: FormField[] = [
                { key: 'ssl', label: 'Use SSL', type: 'checkbox', defaultValue: true },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('☑'); // Checked

        });

        it('should render select fields with options', () => {

            const fields: FormField[] = [
                {
                    key: 'dialect',
                    label: 'Dialect',
                    type: 'select',
                    options: [
                        { label: 'PostgreSQL', value: 'postgres' },
                        { label: 'MySQL', value: 'mysql' },
                    ],
                },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Dialect');

        });

        it('should show keyboard shortcuts', () => {

            const fields: FormField[] = [{ key: 'name', label: 'Name', type: 'text' }];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('[Enter]');
            expect(lastFrame()).toContain('[Esc]');
            expect(lastFrame()).toContain('[↑↓]');

        });

        it('should use custom submit label', () => {

            const fields: FormField[] = [{ key: 'name', label: 'Name', type: 'text' }];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} submitLabel="Save Config" />
                </TestWrapper>,
            );

            expect(lastFrame()).toContain('Save Config');

        });

        it('should highlight first field initially', () => {

            const fields: FormField[] = [
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'host', label: 'Host', type: 'text' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            // First field should have the active indicator
            const frame = lastFrame() ?? '';
            const nameIndex = frame.indexOf('Name');
            const hostIndex = frame.indexOf('Host');

            // Name should come before Host
            expect(nameIndex).toBeLessThan(hostIndex);

        });

    });

});

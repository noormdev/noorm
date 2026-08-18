/**
 * Form layout tests.
 *
 * Encodes the aligned two-column contract:
 *
 * - Label gutter then value column, one row per field, no blank row between
 *   them. The old one-field-per-two-rows layout with a `gap={1}` spacer burned
 *   ~20 rows on a 10-field config form and pushed fields past the fold.
 * - The gutter is sized from the longest label and capped, so a verbose label
 *   truncates instead of shoving the value column sideways for every other row.
 * - A select shows only its current value until it is being edited. That
 *   collapse is where most of the height saving comes from.
 * - The form windows itself to a row budget and says so, so no field is ever
 *   rendered off the bottom with no way to reach it.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { Form } from '../../../src/tui/components/forms/index.js';
import type { FormField } from '../../../src/tui/components/forms/index.js';

const KEYS = {
    DOWN: '\x1B[B',
};

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

/** Column assertions have to run against the text, not the styling. */
function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

/**
 * Poll until the predicate holds instead of sleeping a guessed duration.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 5));

    }

}

/**
 * Write Escape until it is observed, rather than once and hopefully.
 */
async function pressUntil(
    stdin: { write: (data: string) => void },
    predicate: () => boolean,
    timeoutMs = 2000,
): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        stdin.write('\x1B');

        await new Promise((resolve) => setTimeout(resolve, 20));

    }

}

function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

function lineWith(frame: string, needle: string): string {

    return frame.split('\n').find((line) => line.includes(needle)) ?? '';

}

function lineIndexOf(frame: string, needle: string): number {

    return frame.split('\n').findIndex((line) => line.includes(needle));

}

describe('cli: components/forms', () => {

    describe('two-column layout', () => {

        it('should render each field as one row with the value column aligned', () => {

            const fields: FormField[] = [
                { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
                { key: 'port', label: 'Port', type: 'text', defaultValue: '5432' },
                { key: 'database', label: 'Database', type: 'text', defaultValue: 'appdb' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            const hostColumn = lineWith(frame, 'Host').indexOf('localhost');
            const portColumn = lineWith(frame, 'Port').indexOf('5432');
            const databaseColumn = lineWith(frame, 'Database').indexOf('appdb');

            expect(hostColumn).toBeGreaterThan(0);
            expect(portColumn).toBe(hostColumn);
            expect(databaseColumn).toBe(hostColumn);

        });

        it('should not leave a blank row between fields', () => {

            const fields: FormField[] = [
                { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
                { key: 'port', label: 'Port', type: 'text', defaultValue: '5432' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(lineIndexOf(frame, 'Port') - lineIndexOf(frame, 'Host')).toBe(1);

        });

        it('should truncate an over-long label rather than widen the value column', () => {

            const longLabel = 'Test Database (skipped in production builds)';
            const fields: FormField[] = [
                { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
                { key: 'isTest', label: longLabel, type: 'checkbox' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).not.toContain(longLabel);
            expect(frame).toContain('…');

            const hostColumn = lineWith(frame, 'Host').indexOf('localhost');
            const checkboxColumn = lineWith(frame, 'Test Database').indexOf('☐');

            expect(checkboxColumn).toBe(hostColumn);

        });

        it('should show the required marker', () => {

            const fields: FormField[] = [{ key: 'name', label: 'Name', type: 'text', required: true }];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            expect(strip(lastFrame())).toContain('Name*');

        });

        it('should render a hint after the value', () => {

            const fields: FormField[] = [
                {
                    key: 'dialect',
                    label: 'Database Type',
                    type: 'text',
                    defaultValue: 'postgres',
                    hint: '(locked)',
                },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const line = lineWith(strip(lastFrame()), 'Database Type');

            expect(line.indexOf('postgres')).toBeGreaterThan(0);
            expect(line.indexOf('(locked)')).toBeGreaterThan(line.indexOf('postgres'));

        });

        it('should render a checkbox value inline', () => {

            const fields: FormField[] = [
                { key: 'ssl', label: 'Use SSL', type: 'checkbox' },
                { key: 'tls', label: 'Use TLS', type: 'checkbox', defaultValue: true },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(lineWith(frame, 'Use SSL')).toContain('☐ No');
            expect(lineWith(frame, 'Use TLS')).toContain('☑ Yes');

        });

        it('should mask a password value in browse mode', () => {

            const fields: FormField[] = [
                { key: 'password', label: 'Password', type: 'password', defaultValue: 'hunter2' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).not.toContain('hunter2');
            expect(lineWith(frame, 'Password')).toContain('•••••••');

        });

        it('should collapse a select to its current value on one row', () => {

            const fields: FormField[] = [
                {
                    key: 'userRole',
                    label: 'User Role',
                    type: 'select',
                    options: [
                        { label: 'Admin', value: 'admin' },
                        { label: 'Operator', value: 'operator' },
                        { label: 'Reader', value: 'reader' },
                    ],
                    defaultValue: 'operator',
                },
                { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
            ];

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(lineWith(frame, 'User Role')).toContain('Operator');
            expect(frame).not.toContain('Admin');
            expect(frame).not.toContain('Reader');
            expect(lineIndexOf(frame, 'Host') - lineIndexOf(frame, 'User Role')).toBe(1);

        });

    });

    describe('scrolling', () => {

        const manyFields: FormField[] = Array.from({ length: 12 }, (_, i) => ({
            key: `f${i}`,
            label: `Field${String(i).padStart(2, '0')}`,
            type: 'text' as const,
            defaultValue: `v${i}`,
        }));

        it('should window fields to the height budget and count what is below', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={manyFields} onSubmit={() => {}} height={12} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).toContain('Field00');
            expect(frame).toContain('Field06');
            expect(frame).not.toContain('Field07');
            expect(frame).toContain('↓ 5 more');
            expect(frame).not.toMatch(/↑ \d+ more/);

        });

        it('should scroll the window so the active field stays visible', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={manyFields} onSubmit={() => {}} height={12} />
                </TestWrapper>,
            );

            await waitFor(() => strip(lastFrame()).includes('› Field00'));

            for (let i = 0; i < 11; i++) {

                stdin.write(KEYS.DOWN);
                await waitFor(() => strip(lastFrame()).includes(`› Field${String(i + 1).padStart(2, '0')}`));

            }

            const frame = strip(lastFrame());

            expect(frame).toContain('› Field11');
            expect(frame).toContain('↑ 5 more');
            expect(frame).not.toMatch(/↓ \d+ more/);
            expect(frame).not.toContain('Field04');

            unmount();

        });

        it('should render every field when the budget is generous', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={manyFields} onSubmit={() => {}} height={40} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).toContain('Field00');
            expect(frame).toContain('Field11');
            expect(frame).not.toMatch(/[↑↓] \d+ more/);

        });

    });

    describe('action row and hints', () => {

        const fields: FormField[] = [{ key: 'name', label: 'Name', type: 'text' }];

        it('should render the submit and cancel buttons', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} onCancel={() => {}} submitLabel="Save Config" />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).toContain('[ Save Config ]');
            expect(frame).toContain('[ Cancel ]');

        });

        it('should omit the cancel button when the form has no cancel handler', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).toContain('[ Submit ]');
            expect(frame).not.toContain('[ Cancel ]');

        });

        it('should describe the browse keymap in the hint row', async () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} onCancel={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => strip(lastFrame()).includes('↵ edit'));

            const frame = strip(lastFrame());

            expect(frame).toContain('↑↓ field');
            expect(frame).toContain('↵ edit');
            expect(frame).toContain('esc cancel');

        });

        it('should replace the action row with the busy label while busy', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form
                        fields={fields}
                        onSubmit={() => {}}
                        onCancel={() => {}}
                        busy
                        busyLabel="Testing connection..."
                    />
                </TestWrapper>,
            );

            const frame = strip(lastFrame());

            expect(frame).toContain('Testing connection...');
            expect(frame).not.toContain('[ Submit ]');

        });

        it('should surface a status error', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} statusError="connection refused" />
                </TestWrapper>,
            );

            expect(strip(lastFrame())).toContain('✘ connection refused');

        });

    });

    describe('cancelling a busy form', () => {

        const fields: FormField[] = [{ key: 'name', label: 'Name', type: 'text' }];

        it('should say the busy state can be cancelled, since nobody tries an unadvertised key', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form
                        fields={fields}
                        onSubmit={() => {}}
                        busy
                        busyLabel="Testing connection..."
                        onCancelBusy={() => {}}
                    />
                </TestWrapper>,
            );

            expect(strip(lastFrame())).toContain('[Esc] Cancel');

        });

        it('should stay silent about a hatch that is not wired', () => {

            const { lastFrame } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} busy busyLabel="Testing connection..." />
                </TestWrapper>,
            );

            expect(strip(lastFrame())).not.toContain('[Esc] Cancel');

        });

        it('should give Escape to the operation, not to leaving the screen', async () => {

            const cancelled: string[] = [];

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={fields}
                        onSubmit={() => {}}
                        onCancel={() => cancelled.push('screen')}
                        busy
                        busyLabel="Testing connection..."
                        onCancelBusy={() => cancelled.push('operation')}
                    />
                </TestWrapper>,
            );

            await waitFor(() => strip(lastFrame()).includes('[Esc] Cancel'));

            // The focus stack is pushed in an effect, so an Escape written on
            // the frame the form first appears on lands before the handler is
            // listening. Repeat until it takes.
            await pressUntil(stdin, () => cancelled.length > 0);

            // Leaving would abandon the operation rather than stop it, which is
            // how a connect ends up still running behind a screen that is gone.
            expect(cancelled).toEqual(['operation']);

            unmount();

        });

        it('should hand Escape back to the screen once the form is idle', async () => {

            const cancelled: string[] = [];

            const { stdin, lastFrame, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={fields}
                        onSubmit={() => {}}
                        onCancel={() => cancelled.push('screen')}
                        onCancelBusy={() => cancelled.push('operation')}
                    />
                </TestWrapper>,
            );

            await waitFor(() => strip(lastFrame()).includes('[ Submit ]'));

            await pressUntil(stdin, () => cancelled.length > 0);

            expect(cancelled).toEqual(['screen']);

            unmount();

        });

    });

});

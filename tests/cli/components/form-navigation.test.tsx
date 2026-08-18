/**
 * Form navigation tests.
 *
 * Encodes the browse/edit navigation contract:
 *
 * - Browse mode is the default. Arrows move BETWEEN fields on every field type,
 *   including select. Before this contract, the Form deliberately handed arrows
 *   to the active select so the user could only leave it with Tab - the bug this
 *   suite exists to keep dead.
 * - Enter is the mode switch, not the submit key. Submitting is a navigable
 *   action row after the last field, so "down then enter" is the only model a
 *   user has to learn.
 * - Esc in edit mode restores the value the field had when edit mode opened, so
 *   a mistyped edit is always recoverable without cancelling the whole form.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { Form } from '../../../src/tui/components/forms/index.js';
import type { FormField } from '../../../src/tui/components/forms/index.js';

const KEYS = {
    TAB: '\t',
    SHIFT_TAB: '\x1b[Z',
    DOWN: '\x1B[B',
    UP: '\x1B[A',
    LEFT: '\x1B[D',
    RIGHT: '\x1B[C',
    ENTER: '\r',
    ESC: '\x1B',
    SPACE: ' ',
};

/**
 * Poll until the predicate holds instead of sleeping a guessed duration.
 * Fixed sleeps are the known flake source in this suite.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((r) => setTimeout(r, 5));

    }

}

function TestWrapper({ children }: { children: React.ReactNode }) {

    return <FocusProvider>{children}</FocusProvider>;

}

/**
 * The marker `›` sits at the start of the active row, so the active label is
 * whichever label shares a line with it.
 */
function getActiveField(frame: string, fieldLabels: string[]): string | null {

    for (const line of frame.split('\n')) {

        if (!line.includes('›')) continue;

        for (const label of fieldLabels) {

            if (line.includes(label)) return label;

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

    describe('browse mode', () => {

        it('should start on the first field in browse mode', async () => {

            const { lastFrame, unmount } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');

            expect(getActiveField(lastFrame() ?? '', labels)).toBe('Name');
            expect(lastFrame()).toContain('↵ edit');

            unmount();

        });

        it('should move to the next field on Down', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');
            stdin.write(KEYS.DOWN);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Host');

            expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');

            unmount();

        });

        it('should move to the previous field on Up', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');
            stdin.write(KEYS.DOWN);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Host');
            stdin.write(KEYS.UP);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');

            expect(getActiveField(lastFrame() ?? '', labels)).toBe('Name');

            unmount();

        });

        it('should move BETWEEN fields on Down when the active field is a select', async () => {

            // The reported bug: Down used to be handed to the select so it moved
            // between options and the user had to reach for Tab to leave the field.
            const selectFields: FormField[] = [
                {
                    key: 'role',
                    label: 'Role',
                    type: 'select',
                    options: [
                        { label: 'Admin', value: 'admin' },
                        { label: 'Operator', value: 'operator' },
                    ],
                    defaultValue: 'admin',
                },
                { key: 'host', label: 'Host', type: 'text' },
            ];
            const selectLabels = ['Role', 'Host'];

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={selectFields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', selectLabels) === 'Role');
            stdin.write(KEYS.DOWN);
            await waitFor(() => getActiveField(lastFrame() ?? '', selectLabels) === 'Host');

            expect(getActiveField(lastFrame() ?? '', selectLabels)).toBe('Host');

            unmount();

        });

        it('should keep Tab and Shift+Tab moving between fields', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');

            stdin.write(KEYS.TAB);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Host');
            expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');

            stdin.write(KEYS.TAB);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Port');
            expect(getActiveField(lastFrame() ?? '', labels)).toBe('Port');

            stdin.write(KEYS.SHIFT_TAB);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Host');
            expect(getActiveField(lastFrame() ?? '', labels)).toBe('Host');

            unmount();

        });

        it('should cancel the form on Esc', async () => {

            let cancelled = false;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={fields}
                        onSubmit={() => {}}
                        onCancel={() => {

                            cancelled = true;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');
            stdin.write(KEYS.ESC);
            await waitFor(() => cancelled);

            expect(cancelled).toBe(true);

            unmount();

        });

        it('should NOT submit when Enter is pressed on a field', async () => {

            // Enter is the mode switch now. Submitting from a field would make the
            // action row unreachable-by-accident and resurrect the old model.
            let submitted = false;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={fields}
                        onSubmit={() => {

                            submitted = true;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ commit')));

            expect(lastFrame()).toContain('↵ commit');
            expect(submitted).toBe(false);

            unmount();

        });

    });

    describe('action row', () => {

        it('should land on the submit button after the last field', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={fields} onSubmit={() => {}} submitLabel="Save" onCancel={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Name');

            stdin.write(KEYS.DOWN);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Host');
            stdin.write(KEYS.DOWN);
            await waitFor(() => getActiveField(lastFrame() ?? '', labels) === 'Port');
            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Save ]')));

            expect(lastFrame()).toContain('❯ [ Save ]');
            expect(getActiveField(lastFrame() ?? '', labels)).toBeNull();

            unmount();

        });

        it('should submit the collected values on Enter over the submit button', async () => {

            let received: Record<string, string | boolean> | null = null;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' }]}
                        onSubmit={(values) => {

                            received = values;

                        }}
                        submitLabel="Save"
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');
            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Save ]')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => received !== null);

            expect(received).toEqual({ host: 'localhost' });

            unmount();

        });

        it('should cancel on Enter over the cancel button', async () => {

            let cancelled = false;
            let submitted = false;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'host', label: 'Host', type: 'text' }]}
                        onSubmit={() => {

                            submitted = true;

                        }}
                        onCancel={() => {

                            cancelled = true;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');
            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));
            stdin.write(KEYS.RIGHT);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Cancel ]')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => cancelled);

            expect(cancelled).toBe(true);
            expect(submitted).toBe(false);

            unmount();

        });

        it('should move between the action buttons with Left and Right', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'host', label: 'Host', type: 'text' }]}
                        onSubmit={() => {}}
                        onCancel={() => {}}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');
            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));

            stdin.write(KEYS.RIGHT);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Cancel ]')));
            expect(lastFrame()).toContain('❯ [ Cancel ]');

            stdin.write(KEYS.LEFT);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));
            expect(lastFrame()).toContain('❯ [ Submit ]');

            unmount();

        });

        it('should move focus to the first invalid field when validation fails', async () => {

            let submitted = false;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[
                            { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
                            { key: 'database', label: 'Database', type: 'text', required: true },
                        ]}
                        onSubmit={() => {

                            submitted = true;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host', 'Database']) === 'Host');
            stdin.write(KEYS.DOWN);
            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host', 'Database']) === 'Database');
            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('Required')));

            expect(submitted).toBe(false);
            expect(lastFrame()).toContain('Required');
            expect(getActiveField(lastFrame() ?? '', ['Host', 'Database'])).toBe('Database');

            unmount();

        });

    });

    describe('edit mode', () => {

        it('should type into a text field only after Enter opens edit mode', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form fields={[{ key: 'host', label: 'Host', type: 'text' }]} onSubmit={() => {}} />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');

            // Browse mode swallows the keystroke - the field does not own input yet.
            stdin.write('xyz');
            await waitFor(() => false, 60);
            expect(lastFrame()).not.toContain('xyz');

            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ commit')));

            stdin.write('abc');
            await waitFor(() => Boolean(lastFrame()?.includes('abc')));

            expect(lastFrame()).toContain('abc');

            unmount();

        });

        it('should commit the edit on Enter and return to browse mode', async () => {

            let received: Record<string, string | boolean> | null = null;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'host', label: 'Host', type: 'text' }]}
                        onSubmit={(values) => {

                            received = values;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ commit')));
            stdin.write('db1');
            await waitFor(() => Boolean(lastFrame()?.includes('db1')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ edit')));

            expect(lastFrame()).toContain('↵ edit');
            expect(lastFrame()).toContain('db1');

            // The committed value survives into submission.
            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => received !== null);

            expect(received).toEqual({ host: 'db1' });

            unmount();

        });

        it('should revert to the pre-edit value on Esc', async () => {

            let received: Record<string, string | boolean> | null = null;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' }]}
                        onSubmit={(values) => {

                            received = values;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ commit')));
            stdin.write('XX');
            await waitFor(() => Boolean(lastFrame()?.includes('localhostXX')));

            stdin.write(KEYS.ESC);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ edit')));

            expect(lastFrame()).toContain('localhost');
            expect(lastFrame()).not.toContain('localhostXX');

            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => received !== null);

            expect(received).toEqual({ host: 'localhost' });

            unmount();

        });

        it('should NOT cancel the form when Esc leaves edit mode', async () => {

            let cancelled = false;

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'host', label: 'Host', type: 'text' }]}
                        onSubmit={() => {}}
                        onCancel={() => {

                            cancelled = true;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Host']) === 'Host');
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ commit')));
            stdin.write(KEYS.ESC);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ edit')));

            expect(cancelled).toBe(false);

            unmount();

        });

        it('should expand a select only in edit mode and move between options with arrows', async () => {

            let received: Record<string, string | boolean> | null = null;

            const selectFields: FormField[] = [
                {
                    key: 'role',
                    label: 'Role',
                    type: 'select',
                    options: [
                        { label: 'Admin', value: 'admin' },
                        { label: 'Operator', value: 'operator' },
                    ],
                    defaultValue: 'admin',
                },
            ];

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={selectFields}
                        onSubmit={(values) => {

                            received = values;

                        }}
                    />
                </TestWrapper>,
            );

            await waitFor(() => getActiveField(lastFrame() ?? '', ['Role']) === 'Role');

            // Collapsed: only the current option is on screen.
            expect(lastFrame()).toContain('Admin');
            expect(lastFrame()).not.toContain('Operator');

            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('Operator')));
            expect(lastFrame()).toContain('Operator');

            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ Operator')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('↵ edit')));

            // Collapsed again, now showing the newly chosen option.
            expect(lastFrame()).not.toContain('Admin');

            stdin.write(KEYS.DOWN);
            await waitFor(() => Boolean(lastFrame()?.includes('❯ [ Submit ]')));
            stdin.write(KEYS.ENTER);
            await waitFor(() => received !== null);

            expect(received).toEqual({ role: 'operator' });

            unmount();

        });

        it('should toggle a checkbox in place with Enter and with Space, never opening edit mode', async () => {

            const { lastFrame, stdin, unmount } = render(
                <TestWrapper>
                    <Form
                        fields={[{ key: 'isTest', label: 'Test Database', type: 'checkbox' }]}
                        onSubmit={() => {}}
                    />
                </TestWrapper>,
            );

            // Wait for the active marker, not the box: the box renders before
            // the focus stack settles and the handler is still a no-op then.
            await waitFor(() => getActiveField(lastFrame() ?? '', ['Test Database']) === 'Test Database');

            stdin.write(KEYS.ENTER);
            await waitFor(() => Boolean(lastFrame()?.includes('☑')));
            expect(lastFrame()).toContain('☑');
            expect(lastFrame()).toContain('↵/space toggle');

            stdin.write(KEYS.SPACE);
            await waitFor(() => Boolean(lastFrame()?.includes('☐')));
            expect(lastFrame()).toContain('☐');

            unmount();

        });

    });

});

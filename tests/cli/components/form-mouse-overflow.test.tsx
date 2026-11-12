/** Form: clicks, one-row long values, and `x` clearing a password (a wrapped value pushed the buttons off screen). */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { MouseProvider, MOUSE_ENABLE, MOUSE_DISABLE } from '../../../src/tui/mouse.js';
import { Form } from '../../../src/tui/components/forms/index.js';
import { Confirm } from '../../../src/tui/components/dialogs/index.js';
import type { FormField, FormValues } from '../../../src/tui/components/forms/index.js';

const ESC = String.fromCharCode(27);
const WHEEL_DOWN = 65;

/** SGR left-press, 1-based row and column the way a terminal sends them. */
const press = (row: number, column = 1, button = 0) => `${ESC}[<${button};${column};${row}M`;

const KEYS = { DOWN: '\x1B[B', ENTER: '\r' };

const LONG = 'postgresql://some_user:averyveryverylongpasswordthatgoesonandon@db-cluster-prod-01.us-east-1.rds.amazonaws.com:5432/application_database?sslmode=verify-full';

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** The frames the UI drew, without the mouse enable/disable writes. */
const uiFrames = (frames: string[]) => frames.filter((f) => f !== MOUSE_ENABLE && f !== MOUSE_DISABLE);
const lastUi = (frames: string[]) => uiFrames(frames).at(-1) ?? '';

/** Color codes take string positions but no terminal columns, and CI forces color on. */
const plain = (text: string) => text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

/** 1-based terminal row of the line holding `needle`. */
function rowOf(frame: string, needle: string): number {

    const index = plain(frame).split('\n').findIndex((line) => line.includes(needle));

    if (index < 0) throw new Error(`"${needle}" is not in the frame:\n${frame}`);

    return index + 1;

}

/** 1-based terminal column of `needle` on its row, pointing at its second character. */
function columnOf(frame: string, needle: string): number {

    const line = plain(frame).split('\n').find((candidate) => candidate.includes(needle)) ?? '';

    return line.indexOf(needle) + 2;

}

/** Which label shares a line with the `›` marker. */
function activeLine(frame: string): string {

    return frame.split('\n').find((line) => line.includes('›')) ?? '';

}

function Harness({ children }: { children: React.ReactNode }) {

    return (
        <MouseProvider enabled>
            <FocusProvider>{children}</FocusProvider>
        </MouseProvider>
    );

}

const FIELDS: FormField[] = [
    { key: 'name', label: 'Name', type: 'text', defaultValue: 'dev' },
    { key: 'host', label: 'Host', type: 'text', defaultValue: 'localhost' },
    { key: 'ssl', label: 'Use SSL', type: 'checkbox' },
    { key: 'password', label: 'Password', type: 'password', defaultValue: 'hunter2' },
];

async function mountForm(overrides: { fields?: FormField[]; onSubmit?: (v: FormValues) => void; onCancel?: () => void } = {}) {

    const rendered = render(
        <Harness>
            <Form
                fields={overrides.fields ?? FIELDS}
                onSubmit={overrides.onSubmit ?? (() => undefined)}
                onCancel={overrides.onCancel ?? (() => undefined)}
            />
        </Harness>,
    );

    // `›` draws only once the form has focus, and clicks are dropped before that.
    await waitFor(() => lastUi(rendered.frames).includes('›'));
    await tick();

    return rendered;

}

describe('cli: Form mouse', () => {

    it('should move the cursor to the field that was clicked', async () => {

        const { frames, stdin, unmount } = await mountForm();

        stdin.write(press(rowOf(lastUi(frames), 'Host')));
        await waitFor(() => activeLine(lastUi(frames)).includes('Host'));

        expect(activeLine(lastUi(frames))).toContain('Host');
        expect(lastUi(frames)).toContain('↵ edit');

        unmount();

    });

    it('should open a text field for editing on a double click', async () => {

        const { frames, stdin, unmount } = await mountForm();
        const row = rowOf(lastUi(frames), 'Host');

        stdin.write(press(row));
        await tick();
        stdin.write(press(row));
        await waitFor(() => lastUi(frames).includes('commit'));

        expect(lastUi(frames)).toContain('↵ commit');

        unmount();

    });

    it('should toggle a checkbox on one click', async () => {

        const { frames, stdin, unmount } = await mountForm();

        expect(lastUi(frames)).toContain('☐ No');

        stdin.write(press(rowOf(lastUi(frames), 'Use SSL')));
        await waitFor(() => lastUi(frames).includes('☑ Yes'));

        expect(lastUi(frames)).toContain('☑ Yes');

        unmount();

    });

    it('should submit when Submit is clicked', async () => {

        const submitted: FormValues[] = [];
        let cancelled = 0;

        const { frames, stdin, unmount } = await mountForm({
            onSubmit: (values) => submitted.push(values),
            onCancel: () => cancelled++,
        });

        const row = rowOf(lastUi(frames), '[ Submit ]');

        stdin.write(press(row, columnOf(lastUi(frames), '[ Submit ]')));
        await waitFor(() => submitted.length > 0);

        expect(submitted).toHaveLength(1);
        expect(submitted[0]).toMatchObject({ name: 'dev', host: 'localhost' });
        expect(cancelled).toBe(0);

        unmount();

    });

    it('should cancel when Cancel is clicked', async () => {

        const submitted: FormValues[] = [];
        let cancelled = 0;

        const { frames, stdin, unmount } = await mountForm({
            onSubmit: (values) => submitted.push(values),
            onCancel: () => cancelled++,
        });

        stdin.write(press(rowOf(lastUi(frames), '[ Cancel ]'), columnOf(lastUi(frames), '[ Cancel ]')));
        await waitFor(() => cancelled > 0);

        expect(cancelled).toBe(1);
        expect(submitted).toHaveLength(0);

        unmount();

    });

    it('should ignore a click on the button row that lands on neither button', async () => {

        const submitted: FormValues[] = [];
        let cancelled = 0;

        const { frames, stdin, unmount } = await mountForm({
            onSubmit: (values) => submitted.push(values),
            onCancel: () => cancelled++,
        });

        stdin.write(press(rowOf(lastUi(frames), '[ Submit ]'), 70));
        await tick();

        expect(submitted).toHaveLength(0);
        expect(cancelled).toBe(0);

        unmount();

    });

    it('should move between fields on the wheel', async () => {

        const { frames, stdin, unmount } = await mountForm();

        stdin.write(press(1, 1, WHEEL_DOWN));
        await waitFor(() => activeLine(lastUi(frames)).includes('Host'));

        expect(activeLine(lastUi(frames))).toContain('Host');

        unmount();

    });

    it('should commit the field being edited when another field is clicked', async () => {

        const { frames, stdin, unmount } = await mountForm();

        stdin.write(KEYS.ENTER);
        await waitFor(() => lastUi(frames).includes('commit'));
        stdin.write('x');
        await waitFor(() => lastUi(frames).includes('devx'));

        stdin.write(press(rowOf(lastUi(frames), 'Host')));
        await waitFor(() => activeLine(lastUi(frames)).includes('Host') && !lastUi(frames).includes('commit'));

        expect(activeLine(lastUi(frames))).toContain('Host');
        expect(lastUi(frames)).toContain('↵ edit');
        expect(lastUi(frames)).toContain('devx');

        unmount();

    });

});

describe('cli: Form open select mouse', () => {

    const selectFields: FormField[] = [
        {
            key: 'role',
            label: 'Role',
            type: 'select',
            defaultValue: 'viewer',
            options: [
                { label: 'viewer', value: 'viewer' },
                { label: 'operator', value: 'operator' },
                { label: 'admin', value: 'admin' },
            ],
        },
        { key: 'isTest', label: 'Test Database', type: 'checkbox' },
    ];

    it('should take an option on a double click and leave the field below alone', async () => {

        const submitted: FormValues[] = [];

        const { frames, stdin, unmount } = await mountForm({ fields: selectFields, onSubmit: (values) => submitted.push(values) });

        stdin.write(KEYS.ENTER);
        await waitFor(() => lastUi(frames).includes('admin'));

        // The first press must not collapse the list, or the second lands on whatever moved up.
        const row = rowOf(lastUi(frames), 'operator');

        stdin.write(press(row));
        await tick();
        stdin.write(press(row));
        await waitFor(() => !lastUi(frames).includes('admin'));

        expect(lastUi(frames)).toContain('operator');
        expect(lastUi(frames)).toContain('☐ No');

        unmount();

    });

    it('should only highlight an option on a single click', async () => {

        const { frames, stdin, unmount } = await mountForm({ fields: selectFields });

        stdin.write(KEYS.ENTER);
        await waitFor(() => lastUi(frames).includes('admin'));
        stdin.write(press(rowOf(lastUi(frames), 'admin')));
        await waitFor(() => lastUi(frames).includes('❯ admin'));

        expect(lastUi(frames)).toContain('❯ admin');
        expect(lastUi(frames)).toContain('operator');

        unmount();

    });

});

describe('cli: Confirm mouse', () => {

    async function mountConfirm() {

        const answers: string[] = [];

        const rendered = render(
            <Harness>
                <Confirm message="Delete it?" onConfirm={() => answers.push('yes')} onCancel={() => answers.push('no')} />
            </Harness>,
        );

        await waitFor(() => lastUi(rendered.frames).includes('❯'));
        await tick();

        return { ...rendered, answers };

    }

    it('should confirm when Yes is clicked', async () => {

        const { frames, stdin, answers, unmount } = await mountConfirm();

        stdin.write(press(rowOf(lastUi(frames), 'Yes (y)'), columnOf(lastUi(frames), 'Yes (y)')));
        await waitFor(() => answers.length > 0);

        expect(answers).toEqual(['yes']);

        unmount();

    });

    it('should cancel when No is clicked, even though Yes shares the row', async () => {

        const { frames, stdin, answers, unmount } = await mountConfirm();

        stdin.write(press(rowOf(lastUi(frames), 'No (n)'), columnOf(lastUi(frames), 'No (n)')));
        await waitFor(() => answers.length > 0);

        expect(answers).toEqual(['no']);

        unmount();

    });

});

describe('cli: Form long values', () => {

    const longFields: FormField[] = [
        { key: 'name', label: 'Name', type: 'text', defaultValue: 'dev' },
        { key: 'host', label: 'Host', type: 'text', defaultValue: LONG },
        { key: 'password', label: 'Password', type: 'password', defaultValue: LONG },
        { key: 'db', label: 'Database', type: 'text', defaultValue: 'app' },
    ];

    it('should draw each field on one row so the action row stays on screen', async () => {

        const { frames, unmount } = await mountForm({ fields: longFields });
        const lines = lastUi(frames).split('\n');
        const hostRow = lines.findIndex((line) => line.includes('Host'));
        const passwordRow = lines.findIndex((line) => line.includes('Password'));
        const databaseRow = lines.findIndex((line) => line.includes('Database'));

        expect(passwordRow - hostRow).toBe(1);
        expect(databaseRow - passwordRow).toBe(1);
        expect(lastUi(frames)).toContain('[ Submit ]');

        unmount();

    });

    it('should mark a cut value with an ellipsis rather than wrapping it', async () => {

        const { frames, unmount } = await mountForm({ fields: longFields });
        const hostLine = lastUi(frames).split('\n').find((line) => line.includes('Host')) ?? '';

        expect(hostLine).toContain('…');
        expect(lastUi(frames)).not.toContain('verify-full');

        unmount();

    });

    it('should keep a long value on one row while it is edited, showing the end it is typed at', async () => {

        const { frames, stdin, unmount } = await mountForm({ fields: longFields });

        stdin.write(KEYS.DOWN);
        await waitFor(() => activeLine(lastUi(frames)).includes('Host'));
        stdin.write(KEYS.ENTER);
        await waitFor(() => lastUi(frames).includes('commit'));
        await waitFor(() => lastUi(frames).includes('verify-full'));

        const lines = lastUi(frames).split('\n');
        const hostRow = lines.findIndex((line) => line.includes('Host'));

        expect(lines[hostRow]).toContain('verify-full');
        expect(lines[hostRow + 1]).toContain('Password');
        expect(lastUi(frames)).toContain('[ Submit ]');

        unmount();

    });

});

describe('cli: Form clear password', () => {

    it('should empty a highlighted password field on x', async () => {

        const submitted: FormValues[] = [];

        const { frames, stdin, unmount } = await mountForm({ onSubmit: (values) => submitted.push(values) });

        stdin.write(press(rowOf(lastUi(frames), 'Password')));
        await waitFor(() => activeLine(lastUi(frames)).includes('Password'));

        expect(lastUi(frames)).toContain('•••••••');
        expect(lastUi(frames)).toContain('x clear');

        stdin.write('x');
        await waitFor(() => !lastUi(frames).includes('•'));

        expect(lastUi(frames)).not.toContain('•');
        expect(lastUi(frames)).not.toContain('x clear');

        stdin.write(press(rowOf(lastUi(frames), '[ Submit ]'), columnOf(lastUi(frames), '[ Submit ]')));
        await waitFor(() => submitted.length > 0);

        expect(submitted[0]?.['password']).toBe('');

        unmount();

    });

    it('should leave a text field alone on x', async () => {

        const { frames, stdin, unmount } = await mountForm();

        expect(activeLine(lastUi(frames))).toContain('Name');

        stdin.write('x');
        await tick();

        expect(lastUi(frames)).toContain('dev');
        expect(lastUi(frames)).not.toContain('x clear');

        unmount();

    });

    it('should type x into a password field that is open for editing', async () => {

        const { frames, stdin, unmount } = await mountForm();

        stdin.write(press(rowOf(lastUi(frames), 'Password')));
        await waitFor(() => activeLine(lastUi(frames)).includes('Password'));
        stdin.write(KEYS.ENTER);
        await waitFor(() => lastUi(frames).includes('commit'));

        stdin.write('x');
        await waitFor(() => lastUi(frames).includes('hunter2x'));

        expect(lastUi(frames)).toContain('hunter2x');

        unmount();

    });

});

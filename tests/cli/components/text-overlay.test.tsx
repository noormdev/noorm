/**
 * TextOverlay tests.
 *
 * The history screens have to summarise, and a database error does not
 * summarise: the line that names the constraint or the syntax error can be
 * anywhere in it. Before this, one screen cut the message at 80 characters and
 * the other drew a `<Text>` per line with no bound, so a stack trace either lost
 * its middle or took the screen's own footer down with it. This is the way to
 * read the whole thing, so what is pinned is that the whole thing is reachable
 * — the last line as well as the first — and that the overlay stays inside its
 * row budget while doing it.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { TextOverlay } from '../../../src/tui/components/overlays/TextOverlay.js';

/** Long enough that no terminal draws it in one screen. */
const LINES = Array.from({ length: 120 }, (_, index) => `trace-line-${index}`);

const LONG_ERROR = LINES.join('\n');

const ANSI_PATTERN = /\[[0-9;]*m/g;

function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/**
 * Press until the frame says what we are waiting for.
 *
 * The focus stack initialises in an effect, so the first keypress after render
 * is dropped, and writes in a tight loop coalesce into one event. Driving to a
 * condition survives both.
 */
async function pressUntil(
    stdin: { write: (data: string) => void },
    sequence: string,
    predicate: () => boolean,
    limit = 200,
): Promise<void> {

    for (let count = 0; count < limit && !predicate(); count += 1) {

        stdin.write(sequence);

        await new Promise((resolve) => setTimeout(resolve, 5));

    }

}

describe('cli: TextOverlay', () => {

    it('should open on the start of the text and hold the rest back', async () => {

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <TextOverlay title="Error" text={LONG_ERROR} onClose={() => {}} />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('trace-line-0'));

        const frame = strip(lastFrame());

        expect(frame).toContain('Error');
        expect(frame).toContain('trace-line-0');
        expect(frame).not.toContain('trace-line-119');
        expect(frame).toContain('more');

        unmount();

    });

    it('should reach the last line of the message', async () => {

        // The reason the overlay exists. A message this long was previously
        // either cut at 80 characters or drawn in full off the bottom of the
        // screen; neither let a reader see this line.
        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <TextOverlay title="Error" text={LONG_ERROR} onClose={() => {}} />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('trace-line-0'));

        await pressUntil(stdin, '\x04', () => strip(lastFrame()).includes('trace-line-119'));

        expect(strip(lastFrame())).toContain('trace-line-119');

        unmount();

    });

    it('should close on Escape', async () => {

        let closed = false;

        const close = () => {

            closed = true;

        };

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <TextOverlay title="Error" text={LONG_ERROR} onClose={close} />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('trace-line-0'));

        await pressUntil(stdin, '\x1B', () => closed);

        expect(closed).toBe(true);

        unmount();

    });

    it('should wrap a long single line rather than cutting it', async () => {

        // A database error is often one very long line. Cutting it loses the
        // end, which is where the detail usually is.
        const tail = 'CONSTRAINT-VIOLATED-HERE';
        const oneLongLine = `${'padding '.repeat(80)}${tail}`;

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <TextOverlay title="Error" text={oneLongLine} onClose={() => {}} />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('padding'));

        await pressUntil(stdin, '\x04', () => strip(lastFrame()).includes(tail));

        expect(strip(lastFrame())).toContain(tail);

        unmount();

    });

});

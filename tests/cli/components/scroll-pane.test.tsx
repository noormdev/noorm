/**
 * ScrollPane tests.
 *
 * Ink has no scroll offset, so content past the bottom of the terminal is not
 * merely unscrolled — it is unreachable, and the screen's own footer is what
 * gets pushed off to make room for it. The contract pinned here is that every
 * line handed to the pane can be brought on screen by a key, and that the pane
 * never draws more rows than the budget it was given, because the budget is
 * what the screen subtracted its chrome from.
 *
 * The "not focused" case is load-bearing rather than incidental: the pane takes
 * focus as a prop and registers its handler unconditionally (Ink's `useInput`
 * never re-registers once skipped), so the guard inside the handler is the only
 * thing stopping a background pane from consuming a focused screen's arrows.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';

import { ScrollPane } from '../../../src/tui/components/terminal/ScrollPane.js';
import { MouseProvider } from '../../../src/tui/mouse.js';

/** An SGR wheel-down press. 64 is the wheel bit; the low bit picks the direction. */
const WHEEL_DOWN = '\x1B[<65;10;10M';

/** An SGR wheel-up press. */
const WHEEL_UP = '\x1B[<64;10;10M';

/** Rows the pane may draw, indicators included. */
const HEIGHT = 10;

/** More lines than the height, so there is always something below the fold. */
const TOTAL = 40;

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\[[0-9;]*m/g;

function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

/**
 * Poll rather than sleep a guessed duration: a fixed wait is the suite's known
 * flake class under load.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

function lines(count = TOTAL) {

    return Array.from({ length: count }, (_, index) => (
        <Text key={`line:${index}`}>line-{index}</Text>
    ));

}

/**
 * One keypress, then wait for Ink to take it.
 *
 * Writes in a tight loop are coalesced: twenty synchronous `\x04` writes reach
 * `useInput` as one twenty-character string, which is not twenty Ctrl+D events
 * and scrolls exactly one half-page. Yielding between presses is what makes a
 * press a press.
 */
async function press(stdin: { write: (data: string) => void }, sequence: string): Promise<void> {

    stdin.write(sequence);

    await new Promise((resolve) => setTimeout(resolve, 10));

}

describe('cli: ScrollPane', () => {

    it('should draw no more rows than the height it was given', async () => {

        const { stdin, lastFrame, unmount } = render(
            <ScrollPane lines={lines()} height={HEIGHT} isFocused />,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        // At rest and mid-scroll both, because the second is where the pane is
        // tallest: `rowWindow` reserves the two indicator rows as a pair, so at
        // the ends of the scroll one of them is unused and the pane is a row
        // shorter than its budget rather than a row longer.
        expect(strip(lastFrame()).split('\n').length).toBeLessThanOrEqual(HEIGHT);

        await press(stdin, '\x04');

        expect(strip(lastFrame()).split('\n').length).toBeLessThanOrEqual(HEIGHT);
        expect(strip(lastFrame())).toContain('↑');

        unmount();

    });

    it('should hold back the lines past the fold, and say how many', async () => {

        const { lastFrame, unmount } = render(
            <ScrollPane lines={lines()} height={HEIGHT} isFocused />,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        const frame = strip(lastFrame());

        expect(frame).toContain('line-0');
        expect(frame).not.toContain('line-39');
        expect(frame).toContain('more');

        unmount();

    });

    it('should reach the last line by paging', async () => {

        const { stdin, lastFrame, unmount } = render(
            <ScrollPane lines={lines()} height={HEIGHT} isFocused />,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        // Ctrl+D, the advertised half-page key, enough times to pass the end.
        for (let count = 0; count < 20; count += 1) {

            await press(stdin, '\x04');

            if (strip(lastFrame()).includes('line-39')) break;

        }

        expect(strip(lastFrame())).toContain('line-39');

        unmount();

    });

    it('should move one line at a time on an arrow', async () => {

        const { stdin, lastFrame, unmount } = render(
            <ScrollPane lines={lines()} height={HEIGHT} isFocused />,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        stdin.write('\x1B[B');

        await waitFor(() => !strip(lastFrame()).includes('line-0'));

        expect(strip(lastFrame())).toContain('line-1');
        expect(strip(lastFrame())).not.toContain('line-0');

        unmount();

    });

    it('should ignore every scroll key while it is not focused', async () => {

        const { stdin, lastFrame, unmount } = render(
            <ScrollPane lines={lines()} height={HEIGHT} isFocused={false} />,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        const before = strip(lastFrame());

        stdin.write('\x1B[B');
        stdin.write('\x04');

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(strip(lastFrame())).toBe(before);

        unmount();

    });

    it('should scroll on a wheel notch', async () => {

        // The reason this is not optional: the TUI runs in the alternate
        // screen, which has no scrollback, and mouse tracking takes the wheel
        // notches a terminal would otherwise turn into arrow keys. Unhandled
        // here means the wheel does nothing at all.
        const { stdin, lastFrame, unmount } = render(
            <MouseProvider enabled>
                <ScrollPane lines={lines()} height={HEIGHT} isFocused />
            </MouseProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        await press(stdin, WHEEL_DOWN);
        await press(stdin, WHEEL_DOWN);

        await waitFor(() => !strip(lastFrame()).includes('line-0'));

        expect(strip(lastFrame())).toContain('line-2');
        expect(strip(lastFrame())).not.toContain('line-0');

        await press(stdin, WHEEL_UP);

        await waitFor(() => strip(lastFrame()).includes('line-1'));

        expect(strip(lastFrame())).toContain('line-1');

        unmount();

    });

    it('should ignore a wheel notch aimed at a pane that is not focused', async () => {

        const { stdin, lastFrame, unmount } = render(
            <MouseProvider enabled>
                <ScrollPane lines={lines()} height={HEIGHT} isFocused={false} />
            </MouseProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        const before = strip(lastFrame());

        await press(stdin, WHEEL_DOWN);
        await press(stdin, WHEEL_DOWN);

        expect(strip(lastFrame())).toBe(before);

        unmount();

    });

    it('should draw content that fits without stealing a row for an indicator', async () => {

        const { lastFrame, unmount } = render(
            <ScrollPane lines={lines(3)} height={HEIGHT} isFocused />,
        );

        await waitFor(() => strip(lastFrame()).includes('line-0'));

        const frame = strip(lastFrame());

        expect(frame.split('\n')).toHaveLength(3);
        expect(frame).not.toContain('more');

        unmount();

    });

});

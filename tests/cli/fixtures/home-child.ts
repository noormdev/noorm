/** Shared by the fixtures that render a screen in a child process against a throwaway HOME. */
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';

import { getNoormHomePath } from '../../../src/core/identity/storage.js';

/**
 * Exit unless `~/.noorm` resolved under the temp directory, so a fixture run
 * by hand cannot write to a real identity.
 *
 * @example
 * refuseOutsideThrowawayHome()
 */
export function refuseOutsideThrowawayHome(): void {

    if (realpathSync(getNoormHomePath()).startsWith(realpathSync(tmpdir()))) return;

    process.stderr.write(`refusing to run against ${getNoormHomePath()}`);
    process.exit(2);

}

interface Rendered {
    lastFrame: () => string | undefined;
    stdin: { write: (data: string) => void };
}

/**
 * Read frames as plain text and send keys to a rendered screen.
 *
 * @example
 * const { frame, pressUntil } = drive(render(<Screen />))
 * await pressUntil('\r', () => frame().includes('Saved'))
 */
export function drive(screen: Rendered) {

    // CI runs with FORCE_COLOR, which puts color codes inside the frame.
    const frame = () => stripVTControlCharacters(screen.lastFrame() ?? '');

    async function holds(predicate: () => boolean, timeoutMs: number): Promise<boolean> {

        const deadline = Date.now() + timeoutMs;

        while (!predicate() && Date.now() < deadline) {

            await new Promise((r) => setTimeout(r, 20));

        }

        return predicate();

    }

    const timedOut = (timeoutMs: number) => new Error(`condition not met within ${timeoutMs}ms; last frame:\n${frame()}`);

    async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {

        if (!(await holds(predicate, timeoutMs))) throw timedOut(timeoutMs);

    }

    // A key sent before the focused component registers its handler is
    // dropped, so it is repeated until the frame shows it landed.
    async function pressUntil(key: string, landed: () => boolean, timeoutMs = 8000): Promise<void> {

        const deadline = Date.now() + timeoutMs;

        while (!landed()) {

            if (Date.now() > deadline) throw timedOut(timeoutMs);

            screen.stdin.write(key);

            await holds(landed, 100);

        }

    }

    return { frame, waitFor, pressUntil };

}

/**
 * The hover shade, derived from the terminal's own background.
 *
 * A fixed color cannot suit every theme, but a small step toward the foreground
 * from whatever the background is reads as a hover on all of them. Terminals
 * report their background when asked (OSC 11). The query runs before Ink starts
 * because Ink splits the reply into separate keypresses, and a text field would
 * type them.
 *
 * @example
 * const shade = await detectHoverShade(process.stdin, process.stdout);
 * if (shade) setHoverBackground(shade);
 */

/**
 * Background of whatever the pointer is over and a click would act on.
 *
 * ANSI bright black until `noorm ui` has asked the terminal for its own
 * background; then a shade a little off it. Bright black alone is invisible on a
 * theme that maps it to its background.
 */
let hoverShade = 'gray';

export function hoverBackground(): string {

    return hoverShade;

}

export function setHoverBackground(color: string): void {

    hoverShade = color;

}

const ESC = String.fromCharCode(27);

const BACKGROUND_REPLY = new RegExp(`${ESC}\\]11;rgb:([0-9a-fA-F]{1,4})/([0-9a-fA-F]{1,4})/([0-9a-fA-F]{1,4})`);

/** Share of the way toward white (dark theme) or black (light theme) the shade moves. */
const LIGHTEN_BY = 0.1;
const DARKEN_BY = 0.08;

/** One component of an `rgb:` reply, 1 to 4 hex digits wide, scaled to 0-255. */
function scaleComponent(hex: string): number {

    return Math.round((parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);

}

const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

/**
 * The background color in a terminal's OSC 11 reply, as `#rrggbb`, or null.
 *
 * @example
 * parseBackgroundReply('\x1b]11;rgb:1616/1a1a/2020\x1b\\'); // '#161a20'
 */
export function parseBackgroundReply(text: string): string | null {

    const match = BACKGROUND_REPLY.exec(text);

    if (!match) return null;

    const [red, green, blue] = [match[1]!, match[2]!, match[3]!].map(scaleComponent);

    return `#${toHex(red!)}${toHex(green!)}${toHex(blue!)}`;

}

/**
 * A color a little off the background: lighter on a dark theme, darker on a light one.
 *
 * @example
 * hoverShadeFor('#161a20'); // '#2d3136'
 */
export function hoverShadeFor(background: string): string {

    const red = parseInt(background.slice(1, 3), 16);
    const green = parseInt(background.slice(3, 5), 16);
    const blue = parseInt(background.slice(5, 7), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

    const shift = (channel: number) => (luminance < 0.5
        ? channel + (255 - channel) * LIGHTEN_BY
        : channel * (1 - DARKEN_BY));

    return `#${toHex(shift(red))}${toHex(shift(green))}${toHex(shift(blue))}`;

}

/** The parts of `process.stdin` the query uses. */
interface RawInput {
    isTTY?: boolean;
    setRawMode(mode: boolean): unknown;
    resume(): unknown;
    pause(): unknown;
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
    off(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

/** The parts of `process.stdout` the query uses. */
interface TerminalOutput {
    isTTY?: boolean;
    write(text: string): unknown;
}

/**
 * Ask the terminal for its background and return the hover shade for it, or null
 * when it is not a terminal or does not answer in time.
 *
 * Reads raw stdin and hands it back as it found it, so call it before rendering.
 */
export function detectHoverShade(stdin: RawInput, stdout: TerminalOutput, timeoutMs = 120): Promise<string | null> {

    if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(null);

    return new Promise((resolve) => {

        let buffer = '';
        let finished = false;

        const finish = (shade: string | null) => {

            if (finished) return;

            finished = true;
            clearTimeout(giveUp);
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            resolve(shade);

        };

        const giveUp = setTimeout(() => finish(null), timeoutMs);

        const onData = (chunk: Buffer | string) => {

            buffer += chunk.toString();

            const background = parseBackgroundReply(buffer);

            // A short wait lets the reply's terminator arrive here and not in Ink.
            if (background) setTimeout(() => finish(hoverShadeFor(background)), 15);

        };

        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
        stdout.write(`${ESC}]11;?${ESC}\\`);

    });

}

/** The hover shade comes from the terminal's own background, asked for before Ink owns stdin. */
import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';

import {
    detectHoverShade,
    hoverShadeFor,
    parseBackgroundReply,
} from '../../src/tui/terminal-background.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('tui: parseBackgroundReply', () => {

    it('should read a four-digit reply, with either terminator', () => {

        expect(parseBackgroundReply(`${ESC}]11;rgb:1616/1a1a/2020${ESC}\\`)).toBe('#161a20');
        expect(parseBackgroundReply(`${ESC}]11;rgb:1616/1a1a/2020${BEL}`)).toBe('#161a20');

    });

    it('should scale replies that are not four digits wide', () => {

        expect(parseBackgroundReply(`${ESC}]11;rgb:ff/00/80${BEL}`)).toBe('#ff0080');
        expect(parseBackgroundReply(`${ESC}]11;rgb:f/0/f${BEL}`)).toBe('#ff00ff');

    });

    it('should find the reply among other bytes', () => {

        expect(parseBackgroundReply(`xx${ESC}]11;rgb:0000/0000/0000${BEL}yy`)).toBe('#000000');

    });

    it('should return null when there is no background reply', () => {

        expect(parseBackgroundReply('')).toBeNull();
        expect(parseBackgroundReply('hello')).toBeNull();
        expect(parseBackgroundReply(`${ESC}]10;rgb:ffff/ffff/ffff${BEL}`)).toBeNull();

    });

});

describe('tui: hoverShadeFor', () => {

    it('should lighten a dark background a little', () => {

        expect(hoverShadeFor('#161a20')).toBe('#2d3136');

    });

    it('should darken a light background a little', () => {

        expect(hoverShadeFor('#ffffff')).toBe('#ebebeb');

    });

    it('should stay close to the background, so only the shade changes and not the look', () => {

        for (const background of ['#000000', '#161a20', '#808080', '#f2ece0', '#ffffff']) {

            const shade = hoverShadeFor(background);

            for (const offset of [1, 3, 5]) {

                const delta = Math.abs(parseInt(shade.slice(offset, offset + 2), 16) - parseInt(background.slice(offset, offset + 2), 16));

                expect(delta).toBeGreaterThan(0);
                expect(delta).toBeLessThan(40);

            }

        }

    });

});

class FakeStdin extends EventEmitter {

    isTTY = true;
    rawMode: boolean[] = [];
    paused = false;

    setRawMode(mode: boolean): this {

        this.rawMode.push(mode);

        return this;

    }

    resume(): this {

        this.paused = false;

        return this;

    }

    pause(): this {

        this.paused = true;

        return this;

    }

}

function fakeTerminal(reply?: string) {

    const stdin = new FakeStdin();
    const written: string[] = [];

    const stdout = {
        isTTY: true,
        write(text: string): boolean {

            written.push(text);

            if (reply !== undefined) setTimeout(() => stdin.emit('data', Buffer.from(reply)), 5);

            return true;

        },
    };

    return { stdin, stdout, written };

}

describe('tui: detectHoverShade', () => {

    it('should ask for the background and return the shade for the reply', async () => {

        const { stdin, stdout, written } = fakeTerminal(`${ESC}]11;rgb:1616/1a1a/2020${ESC}\\`);

        const shade = await detectHoverShade(stdin, stdout);

        expect(shade).toBe('#2d3136');
        expect(written).toEqual([`${ESC}]11;?${ESC}\\`]);

    });

    it('should hand stdin back as it found it', async () => {

        const { stdin, stdout } = fakeTerminal(`${ESC}]11;rgb:1616/1a1a/2020${ESC}\\`);

        await detectHoverShade(stdin, stdout);

        expect(stdin.rawMode).toEqual([true, false]);
        expect(stdin.paused).toBe(true);
        expect(stdin.listenerCount('data')).toBe(0);

    });

    it('should give up and return null when the terminal does not answer', async () => {

        const { stdin, stdout } = fakeTerminal();

        const shade = await detectHoverShade(stdin, stdout, 30);

        expect(shade).toBeNull();
        expect(stdin.rawMode).toEqual([true, false]);
        expect(stdin.listenerCount('data')).toBe(0);

    });

    it('should not touch a stream that is not a terminal', async () => {

        const { stdin, stdout, written } = fakeTerminal();

        stdin.isTTY = false;

        expect(await detectHoverShade(stdin, stdout)).toBeNull();
        expect(written).toEqual([]);
        expect(stdin.rawMode).toEqual([]);

    });

});

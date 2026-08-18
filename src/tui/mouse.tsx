/**
 * Mouse transport for the TUI.
 *
 * Ink 7.1.1 ships no mouse support at all — no hook, no parsing. The only
 * mention of a mouse in the whole build is a JSDoc note on `measureElement`
 * saying that event coordinates have to be converted before they can be
 * compared with it. So Ink hands over the hit-testing primitive and assumes the
 * events come from somewhere else. This is that somewhere else.
 *
 * **Press and release only.** `?1000` is the weakest tracking mode a terminal
 * offers, and it is all a click and a wheel notch need. `?1002` (drag) and
 * `?1003` (any motion) take the mouse away from the terminal far more
 * completely, and every extra report is a report some other handler has to be
 * taught to ignore.
 *
 * **The reports arrive through `useInput`.** Ink's input parser splits each CSI
 * sequence into its own event and `parse-keypress` leaves an SGR report alone —
 * it comes out as an unnamed key whose `input` is the raw sequence with the
 * escape byte stripped. No patching, no second stdin listener.
 *
 * @example
 * ```tsx
 * <MouseProvider enabled={settings?.ui?.mouse === true}>
 *     <App />
 * </MouseProvider>
 * ```
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { measureElement, useInput, useStdout } from 'ink';
import { attemptSync } from '@logosdx/utils';

import type { ReactElement, ReactNode } from 'react';
import type { DOMElement } from 'ink';

const ESC = '\u001b';

/**
 * Turn on press/release tracking with SGR extended coordinates.
 *
 * SGR (`?1006`) is not optional: the original protocol encodes a coordinate as
 * a single byte, so it cannot report a column past 223, and a maximised
 * terminal is routinely wider than that.
 */
export const MOUSE_ENABLE = `${ESC}[?1000h${ESC}[?1006h`;

/**
 * Turn tracking back off, in the reverse order it went on.
 *
 * Leaving this unwritten is the worst failure this module has: the terminal
 * stays in mouse mode after the process is gone, and click-drag text selection
 * stays broken in every shell in that window until the user resets it by hand.
 */
export const MOUSE_DISABLE = `${ESC}[?1006l${ESC}[?1000l`;

/**
 * `ESC [ < button ; column ; row M` for a press, lowercase `m` for a release.
 *
 * The leading escape byte is stripped by `reportBody` rather than matched here:
 * a control character inside a regular expression is a lint error, and spelling
 * it as a unicode escape does not change what it is.
 */
const SGR_REPORT = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

/**
 * The report without its escape byte.
 *
 * Ink strips it before `useInput` sees the sequence, but anything holding the
 * bytes a terminal actually sent still carries it.
 */
function reportBody(input: string): string {

    return input.startsWith(ESC) ? input.slice(1) : input;

}

const BUTTON_MASK = 0b11;
const SHIFT_BIT = 4;
const ALT_BIT = 8;
const CTRL_BIT = 16;
const MOTION_BIT = 32;
const WHEEL_BIT = 64;

/**
 * Where the live layout region starts on the terminal, 1-based.
 *
 * `measureElement` reports positions inside the live region; SGR reports them
 * against the terminal. The two line up at the origin because the TUI renders
 * in the alternate screen at full terminal height with no `<Static>` anywhere
 * in the tree, so Ink writes the frame from the home position. Verified by
 * capturing what Ink writes: the frame follows `ESC[2J ESC[3J ESC[H`, and an
 * element `measureElement` puts at `y: 2` lands on the third line written.
 *
 * A `<Static>` block above the live region would push this down. There is none;
 * if one ever appears, this is the constant that has to stop being a constant.
 */
const LIVE_REGION_ORIGIN_ROW = 1;
const LIVE_REGION_ORIGIN_COLUMN = 1;

/**
 * How long after a press a second press on the same row counts as a double.
 *
 * The protocol has no double-click event, so the window is ours to pick. 400ms
 * sits inside the range desktop environments use for the same job (GNOME
 * defaults to 400, Windows and macOS to 500), which is what a user's hands are
 * already calibrated to. Shorter windows lose real double-clicks: every report
 * crosses the terminal's input path, and over SSH that adds latency to an
 * interval the user did not change.
 */
export const DOUBLE_CLICK_MS = 400;

/**
 * Which button a report came from.
 *
 * Wheel notches arrive even in press-only tracking, which is why they are here
 * rather than behind a stronger mode.
 */
export type MouseButton = 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down';

/**
 * A decoded mouse report, in live-region coordinates.
 */
export interface MouseEvent {

    /** `M` reports a press, `m` a release. A wheel notch only ever presses. */
    kind: 'press' | 'release';

    button: MouseButton;

    /** Zero-based row, directly comparable with `measureElement`'s `y`. */
    row: number;

    /** Zero-based column, directly comparable with `measureElement`'s `x`. */
    column: number;

    shift: boolean;

    /** The Alt/Option modifier — SGR calls this bit "meta". */
    alt: boolean;

    ctrl: boolean;

}

/**
 * Called with every decoded report while tracking is on.
 */
export type MouseHandler = (event: MouseEvent) => void;

function decodeButton(code: number): MouseButton | null {

    if ((code & WHEEL_BIT) !== 0) {

        return (code & 1) === 0 ? 'wheel-up' : 'wheel-down';

    }

    switch (code & BUTTON_MASK) {

    case 0:
        return 'left';
    case 1:
        return 'middle';
    case 2:
        return 'right';
    default:
        // 3 is the legacy protocol's "some button came up" code, which carries
        // no button identity. SGR reports the real button on release instead,
        // so seeing it here means the report is not one we can act on.
        return null;

    }

}

/**
 * Is this string an SGR mouse report?
 *
 * Separate from `parseMouseReport` because the two questions differ: a handler
 * that accumulates characters needs to drop anything the terminal sent as a
 * mouse report, including the ones the parser declines to decode. Answering
 * that with `parseMouseReport(input) !== null` would type a stray drag report
 * into a filter box.
 *
 * @example
 * useInput((input, key) => {
 *     if (isMouseReport(input)) return;
 * });
 */
export function isMouseReport(input: string): boolean {

    return SGR_REPORT.test(reportBody(input));

}

/**
 * Decode an SGR mouse report into live-region coordinates.
 *
 * Returns `null` for anything that is not a report this module acts on, which
 * includes motion reports: press-only tracking never asks for them, so one
 * arriving is a terminal volunteering more than it was told to, and treating it
 * as a press would make a drag read as a click on every cell it crossed.
 *
 * @example
 * parseMouseReport('[<0;12;5M'); // { kind: 'press', button: 'left', row: 4, column: 11, ... }
 */
export function parseMouseReport(input: string): MouseEvent | null {

    const match = SGR_REPORT.exec(reportBody(input));

    if (!match) return null;

    const code = Number(match[1]);
    const button = (code & MOTION_BIT) === 0 ? decodeButton(code) : null;

    if (button === null) return null;

    return {
        kind: match[4] === 'M' ? 'press' : 'release',
        button,
        row: Number(match[3]) - LIVE_REGION_ORIGIN_ROW,
        column: Number(match[2]) - LIVE_REGION_ORIGIN_COLUMN,
        shift: (code & SHIFT_BIT) !== 0,
        alt: (code & ALT_BIT) !== 0,
        ctrl: (code & CTRL_BIT) !== 0,
    };

}

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Run `restore` on every process path that can still run code.
 *
 * `process.on('exit')` covers more than it looks like: measured on this
 * runtime, it fires for `process.exit()`, an uncaught exception, an unhandled
 * rejection, and a natural end. It does **not** fire when a signal kills a
 * process that has no listener for it, which is the one gap the signal handlers
 * below fill.
 *
 * Those handlers restore and then get out of the way. Registering a signal
 * listener suppresses Node's default termination, and the TUI's lifecycle
 * manager already registers its own for all three, so normally this only adds a
 * write to a path that was going to exit anyway. When ours is the last listener
 * standing it removes itself and re-raises, so the process dies exactly as it
 * would have without this module.
 *
 * @example
 * const uninstall = installTerminalRestore(() => stdout.write(MOUSE_DISABLE));
 */
export function installTerminalRestore(restore: () => void): () => void {

    const onExit = () => {

        restore();

    };

    const onSignal = (signal: NodeJS.Signals) => {

        restore();

        if (process.listenerCount(signal) === 1) {

            process.removeListener(signal, onSignal);
            process.kill(process.pid, signal);

        }

    };

    process.on('exit', onExit);

    for (const signal of SHUTDOWN_SIGNALS) {

        process.on(signal, onSignal);

    }

    return () => {

        process.removeListener('exit', onExit);

        for (const signal of SHUTDOWN_SIGNALS) {

            process.removeListener(signal, onSignal);

        }

    };

}

interface MouseTransport {

    /** Whether tracking is on. Rows only need refs and hit tests when it is. */
    enabled: boolean;

    subscribe: (handler: MouseHandler) => () => void;

}

/**
 * What a component sees with no provider above it — a bare `SelectList` in a
 * test, or the whole app before the mouse setting has loaded.
 */
const MOUSE_OFF: MouseTransport = {
    enabled: false,
    subscribe: () => () => undefined,
};

const MouseContext = createContext<MouseTransport>(MOUSE_OFF);

/**
 * Enables tracking, parses reports, and fans them out to subscribers.
 *
 * Split out from the provider so that with the flag off there is no `useInput`
 * registration, no `setRawMode` call, and no process listener — nothing to
 * measure rather than nothing to see.
 */
function MouseTracking({ handlers }: { handlers: Set<MouseHandler> }): null {

    const { stdout } = useStdout();

    useEffect(() => {

        // attemptSync, not a bare write: the stream can already be gone by the
        // time an exit handler runs, and a throw there would replace a tidy
        // shutdown with a crash.
        const restore = () => {

            attemptSync(() => stdout.write(MOUSE_DISABLE));

        };

        stdout.write(MOUSE_ENABLE);

        const uninstall = installTerminalRestore(restore);

        return () => {

            uninstall();
            restore();

        };

    }, [stdout]);

    useInput((input) => {

        const event = parseMouseReport(input);

        if (!event) return;

        for (const handler of handlers) {

            handler(event);

        }

    });

    return null;

}

/**
 * Props for MouseProvider.
 */
export interface MouseProviderProps {

    /**
     * Whether mouse tracking is on. False is inert: nothing is written to the
     * terminal, nothing listens to stdin, and no process handler is registered.
     */
    enabled: boolean;

    children: ReactNode;

}

/**
 * Makes mouse reports available to the components below it.
 *
 * Takes `enabled` rather than reading settings itself, so the module stays
 * testable without an app context and so the caller decides when the setting is
 * known. It flips false to true once settings load, and the enable sequence
 * goes out then rather than at render time.
 *
 * @example
 * ```tsx
 * <MouseProvider enabled={settings?.ui?.mouse === true}>
 *     <ScreenRenderer />
 * </MouseProvider>
 * ```
 */
export function MouseProvider({ enabled, children }: MouseProviderProps): ReactElement {

    const handlers = useRef<Set<MouseHandler>>(new Set());

    const subscribe = useCallback((handler: MouseHandler) => {

        handlers.current.add(handler);

        return () => {

            handlers.current.delete(handler);

        };

    }, []);

    const value = useMemo(
        () => (enabled ? { enabled, subscribe } : MOUSE_OFF),
        [enabled, subscribe],
    );

    return (
        <MouseContext.Provider value={value}>
            {enabled && <MouseTracking handlers={handlers.current} />}
            {children}
        </MouseContext.Provider>
    );

}

/**
 * The mouse transport, or an inert stand-in when there is no provider.
 *
 * @example
 * const { enabled } = useMouseTransport();
 */
export function useMouseTransport(): MouseTransport {

    return useContext(MouseContext);

}

/**
 * Options for useRowMouse.
 */
export interface RowMouseOptions {

    /**
     * Whether the component owning these rows currently has input.
     *
     * A click acts on whatever already has focus and does nothing anywhere
     * else, so this is the same guard the component's `useInput` handler uses.
     */
    isActive: boolean;

    /** A single click landed on this row. */
    onClick: (index: number) => void;

    /** A second click landed on the same row inside the double-click window. */
    onActivate: (index: number) => void;

    /** A wheel notch: -1 for up, 1 for down. */
    onWheel: (delta: -1 | 1) => void;

}

/**
 * Result of useRowMouse.
 */
export interface RowMouse {

    /** True while tracking is on. */
    enabled: boolean;

    /**
     * Ref for the box drawing row `index`, or `undefined` when the mouse is
     * off so React skips ref handling entirely.
     */
    rowRef: (index: number) => ((node: DOMElement | null) => void) | undefined;

}

/**
 * Which registered row, if any, contains a given live-region row.
 *
 * The column is deliberately ignored. A row's box is only as wide as its
 * content, so requiring a horizontal hit would make a click past the end of a
 * short label miss a row the reader is plainly pointing at.
 */
function hitTest(nodes: Map<number, DOMElement>, row: number): number | null {

    for (const [index, node] of nodes) {

        const box = measureElement(node);

        if (box.height > 0 && row >= box.y && row < box.y + box.height) {

            return index;

        }

    }

    return null;

}

/**
 * Click, double-click and wheel handling for a list of rows.
 *
 * Hit-tests against the rows themselves rather than against arithmetic on a
 * container: a `SelectList` row is one line or two depending on whether that
 * item has a description, and deriving the boundary would mean keeping a second
 * copy of the render's layout rules in step with the first.
 *
 * @example
 * ```tsx
 * const { rowRef } = useRowMouse({
 *     isActive: isFocused,
 *     onClick: setHighlightedIndex,
 *     onActivate: selectRow,
 *     onWheel: (delta) => step(delta),
 * });
 *
 * <Box ref={rowRef(index)}>…</Box>
 * ```
 */
export function useRowMouse({ isActive, onClick, onActivate, onWheel }: RowMouseOptions): RowMouse {

    const { enabled, subscribe } = useMouseTransport();

    const nodes = useRef<Map<number, DOMElement>>(new Map());
    const setters = useRef<Map<number, (node: DOMElement | null) => void>>(new Map());
    const lastPress = useRef<{ index: number; at: number } | null>(null);

    // The handler is registered once and reads the latest props through this
    // ref. Listing them as effect dependencies would resubscribe on every
    // render, since every caller passes inline arrows.
    const latest = useRef({ isActive, onClick, onActivate, onWheel });
    latest.current = { isActive, onClick, onActivate, onWheel };

    useEffect(() => {

        if (!enabled) return;

        return subscribe((event) => {

            const current = latest.current;

            if (!current.isActive || event.kind !== 'press') return;

            if (event.button === 'wheel-up') {

                current.onWheel(-1);

                return;

            }

            if (event.button === 'wheel-down') {

                current.onWheel(1);

                return;

            }

            if (event.button !== 'left') return;

            const index = hitTest(nodes.current, event.row);

            if (index === null) return;

            const now = Date.now();
            const previous = lastPress.current;
            const isDouble = previous !== null
                && previous.index === index
                && now - previous.at <= DOUBLE_CLICK_MS;

            // Clearing on a double is what keeps a third click from activating
            // again: a triple click is a double followed by a fresh single.
            lastPress.current = isDouble ? null : { index, at: now };

            if (isDouble) current.onActivate(index);
            else current.onClick(index);

        });

    }, [enabled, subscribe]);

    const rowRef = useCallback(
        (index: number) => {

            if (!enabled) return undefined;

            const existing = setters.current.get(index);

            if (existing) return existing;

            // Cached per index so React sees the same ref across renders and
            // does not detach and reattach every row on every frame.
            const setter = (node: DOMElement | null) => {

                if (node) nodes.current.set(index, node);
                else nodes.current.delete(index);

            };

            setters.current.set(index, setter);

            return setter;

        },
        [enabled],
    );

    return { enabled, rowRef };

}

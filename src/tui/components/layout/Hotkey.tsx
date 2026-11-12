/**
 * Hotkey - a `[key] Label` hint that a click answers by pressing that key.
 *
 * The click emits the same string the keyboard would, through Ink's input
 * emitter, so whichever component holds focus responds exactly as it would to
 * the key. No screen needs a second code path for the mouse, and a hint can
 * never do something the key does not.
 *
 * @example
 * ```tsx
 * <Box columnGap={2}>
 *     <Hotkey keys="a">Add</Hotkey>
 *     <Hotkey keys="Esc">Back</Hotkey>
 * </Box>
 * ```
 */
import { EventEmitter } from 'node:events';

import { Box, Text, useStdin } from 'ink';

import type { ReactElement, ReactNode } from 'react';

import { useIsGuarded, useIsTyping } from '../../focus.js';
import { hoverBackground, useRowMouse } from '../../mouse.js';

const ESC = String.fromCharCode(27);

const NAMED_KEYS: Record<string, string> = {
    esc: ESC,
    enter: '\r',
    '↵': '\r',
    tab: '\t',
    space: ' ',
};

/**
 * The input a hint's key label stands for, or null when it names no single key.
 *
 * `Enter/Esc` takes the first alternative. Navigation hints such as `↑↓`,
 * `^U/^D` and `any` name no one key, so they stay plain text.
 *
 * @example
 * resolveHotkey('Esc');       // '\x1b'
 * resolveHotkey('Enter/Esc'); // '\r'
 * resolveHotkey('↑↓');        // null
 */
export function resolveHotkey(keys: string): string | null {

    if (keys === '/') return '/';

    const resolved = keys.split('/').map((part) => {

        const name = part.trim();

        if (/^[!-~]$/.test(name)) return name;

        if (/^Shift\+[A-Za-z]$/.test(name)) return name.slice(-1).toUpperCase();

        return NAMED_KEYS[name.toLowerCase()] ?? null;

    });

    // Every part has to be a key: `Ctrl+U/D` must not become a bare `D`.
    return resolved.every((part) => part !== null) ? resolved[0] ?? null : null;

}

/**
 * Ink's input emitter, which every `useInput` handler listens on.
 *
 * It is on the stdin context at runtime but absent from `useStdin`'s public
 * type; `hotkey.test.tsx` fails if an Ink upgrade moves it.
 */
function inputEmitter(context: object): EventEmitter | null {

    if (!('internal_eventEmitter' in context)) return null;

    return context.internal_eventEmitter instanceof EventEmitter ? context.internal_eventEmitter : null;

}

export interface HotkeyProps {

    /** The key label inside the brackets, as the hint shows it: `Esc`, `Enter/Esc`, `a`. */
    keys: string;

    /** The action text after the brackets. */
    children: ReactNode;

    /** Dim the whole hint. Footer hints are dim; a hint in a list of actions is not. */
    dim?: boolean;

    /** Color for the bracketed key alone. */
    keyColor?: string;

    /** Color for the whole hint, such as a yellow mode banner. */
    color?: string;

}

/**
 * A row of hints written as one string, split into one clickable Hotkey each.
 *
 * @example
 * <HotkeyLine>[Enter] Run · [d] Details · [Esc] Back</HotkeyLine>
 */
export function HotkeyLine({ children, dim = true, color }: { children: string; dim?: boolean; color?: string }): ReactElement {

    const hints = [...children.matchAll(/\[([^\]]+)\]\s*([^[]*)/g)];

    return (
        <Box columnGap={2}>
            {hints.map(([, keys = '', label = ''], index) => (
                <Hotkey key={index} keys={keys} dim={dim} color={color}>{label.replace(/\s*·\s*$/, '').trim()}</Hotkey>
            ))}
        </Box>
    );

}

export interface KeyTargetProps {

    /** The key label the click stands for, as `Hotkey` takes it. */
    keys: string;

    children: ReactNode;

    /** Stretch to the parent's width, so the shaded band and the click target span the row. */
    block?: boolean;

    /** The key does nothing right now (a row the keyboard also skips): no press and no shade. */
    disabled?: boolean;

}

/**
 * Anything a click should answer by pressing a key: a row of an action list, a
 * menu entry. Presses once per double click, nothing while a confirmation holds
 * the screen, and no letter while a text field is taking input.
 *
 * @example
 * <KeyTarget keys="s" block><Text>Settings</Text></KeyTarget>
 */
export function KeyTarget({ keys, children, block = false, disabled = false }: KeyTargetProps): ReactElement {

    const sequence = resolveHotkey(keys);
    const emitter = inputEmitter(useStdin());
    const isTyping = useIsTyping();
    const isGuarded = useIsGuarded();

    const isBlocked = () => sequence === null
        || disabled
        || isGuarded('modal')
        || (/^[ -~]$/.test(sequence) && isTyping());

    const press = () => {

        if (sequence === null || emitter === null || isBlocked()) return;

        emitter.emit('input', sequence);

    };

    const { rowRef, hovered } = useRowMouse({
        isActive: sequence !== null,
        matchColumn: true,
        ignoreRepeats: true,
        onClick: press,
        onActivate: () => undefined,
        onWheel: () => undefined,
    });

    return (
        <Box
            ref={rowRef(0)}
            alignSelf={block ? 'stretch' : 'flex-start'}
            backgroundColor={hovered === 0 && !isBlocked() ? hoverBackground() : undefined}
        >
            {children}
        </Box>
    );

}

export function Hotkey({ keys, children, dim = true, keyColor, color }: HotkeyProps): ReactElement {

    return (
        <KeyTarget keys={keys}>
            <Text dimColor={dim} color={color} wrap="truncate">
                {keyColor ? <Text color={keyColor}>[{keys}]</Text> : `[${keys}]`} {children}
            </Text>
        </KeyTarget>
    );

}

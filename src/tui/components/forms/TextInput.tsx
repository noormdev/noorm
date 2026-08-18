/**
 * Single-line text input.
 *
 * A copy of `@inkjs/ui`'s `TextInput` (MIT) with exactly one behavioural
 * change: a mouse report is dropped instead of typed into the field.
 *
 * **Why a copy and not a wrapper.** Upstream's handler ends in an
 * unconditional `state.insert(input)`, and Ink's `useInput` is subscriber-based
 * — every registered handler receives every keystroke and there is no
 * `stopPropagation`. So a mouse report reaches that `insert` no matter what
 * else consumes it first, and the guard has to live inside the handler.
 * Composing one from outside would need `useTextInputState` and `useTextInput`,
 * and `@inkjs/ui`'s `exports` map publishes only the package root, so neither
 * hook is importable. Owning the file is the only seam there is.
 *
 * The leak this closes is not cosmetic. `ChangeAddScreen` slugifies its
 * description into the change folder name and then creates that folder, so a
 * click landed while typing produced `2026-08-17-0-20-11m-0-20-11m` as a real
 * directory. Both terminators leak — a press ends in `M`, a release in `m` —
 * and a single gesture emits several, so the damage compounds within one click.
 *
 * Everything else is upstream's behaviour on purpose, including the parts that
 * would be written differently in new code. See the comments on the handler.
 *
 * @example
 * ```tsx
 * <TextInput
 *     placeholder="Add user roles table"
 *     defaultValue={name}
 *     onChange={setName}
 *     isDisabled={!isFocused}
 * />
 * ```
 */
import { useEffect, useMemo, useReducer } from 'react';
import { Text, useInput } from 'ink';

import type { ReactElement, ReactNode } from 'react';

import { isMouseReport } from '../../mouse.js';

interface TextInputState {

    /**
     * The value before the last edit.
     *
     * Only exists so the change effect can tell an edit from a re-render. It is
     * what makes `onChange` fire once per keystroke rather than once per frame.
     */
    previousValue: string;

    value: string;

    cursorOffset: number;

}

type TextInputAction =
    | { type: 'move-cursor-left' }
    | { type: 'move-cursor-right' }
    | { type: 'insert'; text: string }
    | { type: 'delete' };

function reducer(state: TextInputState, action: TextInputAction): TextInputState {

    switch (action.type) {

    case 'move-cursor-left':

        return { ...state, cursorOffset: Math.max(0, state.cursorOffset - 1) };

    case 'move-cursor-right':

        return { ...state, cursorOffset: Math.min(state.value.length, state.cursorOffset + 1) };

    case 'insert':

        return {
            ...state,
            previousValue: state.value,
            value: state.value.slice(0, state.cursorOffset)
                + action.text
                + state.value.slice(state.cursorOffset),
            cursorOffset: state.cursorOffset + action.text.length,
        };

    case 'delete': {

        const nextOffset = Math.max(0, state.cursorOffset - 1);

        return {
            ...state,
            previousValue: state.value,
            value: state.value.slice(0, nextOffset) + state.value.slice(nextOffset + 1),
            cursorOffset: nextOffset,
        };

    }

    }

}

/**
 * Props for TextInput.
 *
 * Identical to `@inkjs/ui`'s `TextInputProps`, so a call site swaps the import
 * and nothing else.
 */
export interface TextInputProps {

    /** When disabled, user input is ignored and the value renders without a cursor. */
    readonly isDisabled?: boolean;

    /** Text to display when the input is empty. */
    readonly placeholder?: string;

    /** Starting value. The input is uncontrolled; changes are reported, not accepted back. */
    readonly defaultValue?: string;

    /** Candidates to autocomplete the value with. */
    readonly suggestions?: string[];

    /** Called with the new value on every edit. */
    readonly onChange?: (value: string) => void;

    /** Called with the value when Enter is pressed. */
    readonly onSubmit?: (value: string) => void;

}

/**
 * Text input that ignores mouse reports.
 *
 * @example
 * <TextInput defaultValue={value} onChange={setValue} onSubmit={commit} />
 */
export function TextInput({
    isDisabled = false,
    defaultValue = '',
    placeholder = '',
    suggestions,
    onChange,
    onSubmit,
}: TextInputProps): ReactElement {

    const [state, dispatch] = useReducer(reducer, {
        previousValue: defaultValue,
        value: defaultValue,
        cursorOffset: defaultValue.length,
    });

    const suggestion = useMemo(() => {

        if (state.value.length === 0) return undefined;

        return suggestions
            ?.find((candidate) => candidate.startsWith(state.value))
            ?.replace(state.value, '');

    }, [state.value, suggestions]);

    // Keyed on the `onChange` identity, so an inline arrow re-fires the last
    // change on every render. `Form.tsx` caches a handler per field because of
    // it; that contract is upstream's and is kept deliberately.
    useEffect(() => {

        if (state.value !== state.previousValue) onChange?.(state.value);

    }, [state.previousValue, state.value, onChange]);

    // `isActive` rather than a guard inside the handler: `isDisabled` is a prop,
    // not a focus-stack value, so the effect re-runs when it flips and the
    // handler registers then. Upstream's wiring, and the reason a disabled input
    // is display-only.
    useInput((input, key) => {

        // The whole point of this file. A mouse report reaches every useInput
        // handler as a plain string, and the insert at the bottom of this
        // handler would type `[<0;12;5M` into the field.
        if (isMouseReport(input)) return;

        if (key.upArrow || key.downArrow || (key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) {

            return;

        }

        if (key.return) {

            if (suggestion) {

                dispatch({ type: 'insert', text: suggestion });
                onSubmit?.(state.value + suggestion);

                return;

            }

            onSubmit?.(state.value);

            return;

        }

        if (key.leftArrow) {

            dispatch({ type: 'move-cursor-left' });

        }
        else if (key.rightArrow) {

            dispatch({ type: 'move-cursor-right' });

        }
        // `key.delete` alongside `key.backspace` makes the Delete key erase
        // backwards, which `tui-development.md` tells new code not to do. Kept
        // because it is what all 21 call sites have always done, and changing
        // it here would be a keyboard change smuggled in with a mouse fix.
        else if (key.backspace || key.delete) {

            dispatch({ type: 'delete' });

        }
        else {

            dispatch({ type: 'insert', text: input });

        }

    }, { isActive: !isDisabled });

    return <Text>{render({ isDisabled, placeholder, state, suggestion })}</Text>;

}

interface RenderOptions {
    isDisabled: boolean;
    placeholder: string;
    state: TextInputState;
    suggestion: string | undefined;
}

/**
 * The value as it is drawn, cursor included.
 *
 * Built from nested `<Text>` rather than `chalk` calls: Ink's `Text` applies
 * `chalk.inverse` and `chalk.dim` itself for the `inverse` and `dimColor`
 * props, so the emitted string matches upstream's while `chalk` stays out of
 * this package's dependencies.
 */
function render({ isDisabled, placeholder, state, suggestion }: RenderOptions): ReactNode {

    const { value, cursorOffset } = state;

    if (value.length === 0) {

        if (isDisabled) return placeholder ? <Text dimColor>{placeholder}</Text> : '';

        if (placeholder.length === 0) return <Text inverse> </Text>;

        return (
            <>
                <Text inverse>{placeholder.slice(0, 1)}</Text>
                <Text dimColor>{placeholder.slice(1)}</Text>
            </>
        );

    }

    if (isDisabled) return value;

    const atCursor = value.slice(cursorOffset, cursorOffset + 1);

    return (
        <>
            {value.slice(0, cursorOffset)}
            {atCursor.length > 0 && <Text inverse>{atCursor}</Text>}
            {value.slice(cursorOffset + 1)}
            {suggestion && atCursor.length === 0 && (
                <>
                    <Text inverse>{suggestion.slice(0, 1)}</Text>
                    <Text dimColor>{suggestion.slice(1)}</Text>
                </>
            )}
            {suggestion && atCursor.length > 0 && <Text dimColor>{suggestion}</Text>}
            {!suggestion && atCursor.length === 0 && <Text inverse> </Text>}
        </>
    );

}

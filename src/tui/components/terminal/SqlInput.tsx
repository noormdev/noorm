/**
 * SQL Input component.
 *
 * Multi-line text input with edit mode for SQL queries.
 *
 * **Modes:**
 * - Normal mode (default): Enter = execute, Shift+Enter = newline
 * - Edit mode (Shift+Tab toggle): Enter = newline, easier for multi-line SQL
 */
import { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';

/**
 * Props for SqlInput component.
 */
export interface SqlInputProps {
    /** Current input value */
    value: string;
    /** Called when value changes */
    onChange: (value: string) => void;
    /** Called when query is submitted (Enter in normal mode) */
    onSubmit: (query: string) => void;
    /** Called when navigating history (up/down when input empty) */
    onHistoryNavigate: (direction: 'up' | 'down') => void;
    /** Whether input is disabled (during execution) */
    disabled?: boolean;
    /** Whether input is active and should handle keyboard input */
    active?: boolean;
    /** Whether currently browsing history (allows up/down even with content) */
    historyBrowsing?: boolean;
    /** Placeholder text when empty */
    placeholder?: string;
}

/**
 * SQL Input component with edit mode support.
 */
export function SqlInput({
    value,
    onChange,
    onSubmit,
    onHistoryNavigate,
    disabled = false,
    active = true,
    historyBrowsing = false,
    placeholder = 'Enter SQL query...',
}: SqlInputProps): ReactElement {

    const isActive = active && !disabled;
    const [editMode, setEditMode] = useState(false);
    const [cursor, setCursor] = useState(value.length);

    // Track what we last set to detect external changes
    const lastValueRef = useRef(value);

    // When value changes externally (e.g., history nav), move cursor to end
    useEffect(() => {

        if (value !== lastValueRef.current) {

            setCursor(value.length);
            lastValueRef.current = value;

        }

    }, [value]);

    // Helper to update value and track it
    const updateValue = (newValue: string, newCursor: number) => {

        lastValueRef.current = newValue;
        onChange(newValue);
        setCursor(newCursor);

    };

    useInput((input, key) => {

        if (!isActive) return;

        // Shift+Tab: Toggle edit mode
        if (key.shift && key.tab) {

            setEditMode((prev) => !prev);

            return;

        }

        // Escape: Exit edit mode
        if (key.escape) {

            if (editMode) {

                setEditMode(false);

            }

            return;

        }

        // History navigation (up/down when input is empty OR browsing history)
        if ((key.upArrow || key.downArrow) && (value.trim() === '' || historyBrowsing)) {

            onHistoryNavigate(key.upArrow ? 'up' : 'down');

            return;

        }

        // Left arrow: move cursor left
        if (key.leftArrow) {

            setCursor((c) => Math.max(0, c - 1));

            return;

        }

        // Right arrow: move cursor right
        if (key.rightArrow) {

            setCursor((c) => Math.min(value.length, c + 1));

            return;

        }

        // Up/down in multi-line - just ignore for now
        if (key.upArrow || key.downArrow) {

            return;

        }

        // Enter handling
        if (key.return) {

            if (key.shift || editMode) {

                const before = value.slice(0, cursor);
                const after = value.slice(cursor);

                updateValue(before + '\n' + after, cursor + 1);

            }
            else if (value.trim()) {

                onSubmit(value);

            }

            return;

        }

        // Tab: Insert 4 spaces
        if (key.tab && !key.shift) {

            const before = value.slice(0, cursor);
            const after = value.slice(cursor);

            updateValue(before + '    ' + after, cursor + 4);

            return;

        }

        // Backspace/delete: same pattern as @inkjs/ui TextInput
        if (key.backspace || key.delete) {

            if (cursor > 0) {

                const before = value.slice(0, cursor - 1);
                const after = value.slice(cursor);

                updateValue(before + after, cursor - 1);

            }

            return;

        }

        // Regular character input
        if (input) {

            const before = value.slice(0, cursor);
            const after = value.slice(cursor);

            updateValue(before + input + after, cursor + input.length);

        }

    });

    // Render
    const lines = value.split('\n');
    const showPlaceholder = value.length === 0 && !disabled;
    const prompt = editMode ? '[EDIT]>' : '>';
    const promptColor = editMode ? 'yellow' : 'cyan';

    // Find cursor line and column
    let cursorLine = 0;
    let cursorCol = cursor;
    let count = 0;

    for (let i = 0; i < lines.length; i++) {

        const lineLen = lines[i]!.length;

        if (count + lineLen >= cursor) {

            cursorLine = i;
            cursorCol = cursor - count;

            break;

        }

        count += lineLen + 1;

    }

    const renderLine = (line: string, lineIndex: number): ReactElement => {

        const hasCursor = isActive && lineIndex === cursorLine;

        if (!hasCursor) {

            return <Text color={disabled ? 'gray' : undefined}>{line || ' '}</Text>;

        }

        const before = line.slice(0, cursorCol);
        const cursorChar = line[cursorCol] ?? ' ';
        const after = line.slice(cursorCol + 1);

        return (
            <Text color={disabled ? 'gray' : undefined}>
                {before}
                <Text inverse>{cursorChar}</Text>
                {after}
            </Text>
        );

    };

    return (
        <Box flexDirection="column">
            <Box flexDirection="column">
                {lines.map((line, index) => (
                    <Box key={index}>
                        {index === 0 ? (
                            <Text color={disabled ? 'gray' : promptColor}>{prompt} </Text>
                        ) : (
                            <Text color="gray">{'  '} </Text>
                        )}
                        {showPlaceholder && index === 0 ? (
                            <Text dimColor>{placeholder}</Text>
                        ) : (
                            renderLine(line, index)
                        )}
                    </Box>
                ))}
            </Box>
            <Box marginTop={1}>
                <Text dimColor>
                    {editMode
                        ? '[Shift+Tab] Exit edit  [Enter] New line'
                        : '[Shift+Tab] Edit mode  [Enter] Execute  [Shift+Enter] New line'}
                </Text>
            </Box>
        </Box>
    );

}

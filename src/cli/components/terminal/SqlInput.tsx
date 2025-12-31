/**
 * SQL Input component.
 *
 * Multi-line text input with edit mode for SQL queries.
 *
 * **Modes:**
 * - Normal mode (default): Enter = execute, Shift+Enter = newline
 * - Edit mode (Shift+Tab toggle): Enter = newline, easier for multi-line SQL
 *
 * @example
 * ```tsx
 * <SqlInput
 *     value={query}
 *     onChange={setQuery}
 *     onSubmit={(sql) => executeQuery(sql)}
 *     onHistoryNavigate={(dir) => navigateHistory(dir)}
 * />
 * ```
 */
import { useState, useCallback, useRef, useEffect } from 'react';
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
    placeholder = 'Enter SQL query...',
}: SqlInputProps): ReactElement {

    const isActive = active && !disabled;
    const [editMode, setEditMode] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(value.length);

    // Update cursor position when value changes externally
    useEffect(() => {

        setCursorPosition(value.length);

    }, [value]);

    // Handle keyboard input
    useInput((input, key) => {

        if (!isActive) return;

        // Shift+Tab: Toggle edit mode
        if (key.shift && key.tab) {

            setEditMode((prev) => !prev);

            return;

        }

        // Escape: Exit edit mode or signal back
        if (key.escape) {

            if (editMode) {

                setEditMode(false);

            }

            return;

        }

        // History navigation (up/down when input is empty)
        if ((key.upArrow || key.downArrow) && value.trim() === '') {

            onHistoryNavigate(key.upArrow ? 'up' : 'down');

            return;

        }

        // Arrow keys for cursor movement within multi-line
        if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {

            // For now, just track cursor at end
            // Full cursor navigation would require more complex state

            return;

        }

        // Enter handling depends on mode
        if (key.return) {

            if (key.shift || editMode) {

                // Shift+Enter or edit mode: Insert newline
                onChange(value + '\n');
                setCursorPosition(value.length + 1);

            }
            else {

                // Normal mode: Submit query
                if (value.trim()) {

                    onSubmit(value);

                }

            }

            return;

        }

        // Tab: Insert spaces (4 spaces for indent)
        if (key.tab && !key.shift) {

            onChange(value + '    ');
            setCursorPosition(value.length + 4);

            return;

        }

        // Backspace: Delete last character
        if (key.backspace) {

            if (value.length > 0) {

                onChange(value.slice(0, -1));
                setCursorPosition(Math.max(0, value.length - 1));

            }

            return;

        }

        // Delete key: Same as backspace for now
        if (key.delete) {

            if (value.length > 0) {

                onChange(value.slice(0, -1));
                setCursorPosition(Math.max(0, value.length - 1));

            }

            return;

        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {

            onChange(value + input);
            setCursorPosition(value.length + input.length);

        }

    });

    // Split value into lines for rendering
    const lines = value.split('\n');
    const showPlaceholder = value.length === 0 && !disabled;

    // Determine prompt based on mode
    const prompt = editMode ? '[EDIT]>' : '>';
    const promptColor = editMode ? 'yellow' : 'cyan';

    return (
        <Box flexDirection="column">
            {/* Input area */}
            <Box flexDirection="column">
                {lines.map((line, index) => (
                    <Box key={index}>
                        {/* Show prompt only on first line */}
                        {index === 0 ? (
                            <Text color={disabled ? 'gray' : promptColor}>
                                {prompt}{' '}
                            </Text>
                        ) : (
                            <Text color="gray">{'  '} </Text>
                        )}
                        {/* Line content */}
                        {showPlaceholder && index === 0 ? (
                            <Text dimColor>{placeholder}</Text>
                        ) : (
                            <Text color={disabled ? 'gray' : undefined}>
                                {line}
                                {/* Cursor indicator on last line */}
                                {index === lines.length - 1 && isActive && (
                                    <Text inverse> </Text>
                                )}
                            </Text>
                        )}
                    </Box>
                ))}
            </Box>

            {/* Mode indicator */}
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

/**
 * KeyHandler - reusable keyboard handler component.
 *
 * Handles common key patterns (Escape, Retry, Cancel) used across
 * run screens and other contexts where inline keyboard handling is needed.
 *
 * @example
 * ```tsx
 * <KeyHandler
 *     focusLabel="RunFileError"
 *     onEscape={back}
 *     onRetry={() => executeFile(true)}
 * />
 * ```
 */
import { useInput } from 'ink';

import { useFocusScope } from '../../focus.js';

/**
 * KeyHandler props.
 */
export interface KeyHandlerProps {
    /** Focus scope label for keyboard isolation */
    focusLabel: string;

    /** Called on Escape when no onCancel is provided */
    onEscape?: () => void;

    /** Called on 'r' key press */
    onRetry?: () => void;

    /** Called on 'c' key or Escape (takes priority over onEscape) */
    onCancel?: () => void;
}

/**
 * Invisible component that handles Escape, Cancel (c), and Retry (r) keys.
 *
 * Renders nothing - purely a keyboard handler with focus scope isolation.
 *
 * @example
 * ```tsx
 * <KeyHandler focusLabel="RunFileRunning" onCancel={cancelExecution} />
 * ```
 */
export function KeyHandler({ focusLabel, onEscape, onRetry, onCancel }: KeyHandlerProps): null {

    const { isFocused } = useFocusScope(focusLabel);

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            if (onCancel) {

                onCancel();

            }
            else if (onEscape) {

                onEscape();

            }

            return;

        }

        if (input === 'r' && onRetry) {

            onRetry();

        }

        if (input === 'c' && onCancel) {

            onCancel();

        }

    });

    return null;

}

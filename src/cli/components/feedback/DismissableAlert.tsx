/**
 * DismissableAlert - Reusable confirmation/warning dialog.
 *
 * Supports three user responses:
 * - Confirm: Perform the action
 * - Later: Dismiss for this session only
 * - Deny: Cancel the action
 *
 * Can persist user preference to global settings via alertKey.
 * Checks stored preference on mount and auto-resolves if 'always' or 'never'.
 *
 * @example
 * ```tsx
 * <DismissableAlert
 *     alertKey="majorVersionUpdate"
 *     title="Major Update Available"
 *     message="Version 2.0.0 may include breaking changes."
 *     variant="warning"
 *     confirmText="Update Now"
 *     denyText="Skip"
 *     laterText="Remind Me Later"
 *     onConfirm={() => performUpdate()}
 *     onDeny={() => skipUpdate()}
 *     onLater={() => dismissForSession()}
 * />
 * ```
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import {
    getDismissablePreference,
    updateDismissablePreference,
} from '../../../core/update/global-settings.js';
import type { DismissablePreference } from '../../../core/update/types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * DismissableAlert props.
 */
export interface DismissableAlertProps {
    /** Unique key for persisting preference in global settings */
    alertKey: string;

    /** Alert title/header */
    title: string;

    /** Main message body */
    message: string;

    /** Variant affects styling */
    variant?: 'warning' | 'info' | 'confirm';

    /** Text for confirm button (default: "Confirm") */
    confirmText?: string;

    /** Text for deny button (default: "Cancel") */
    denyText?: string;

    /** Text for later/dismiss button (default: "Remind me later") */
    laterText?: string;

    /** Show "Don't ask again" checkbox option */
    allowPersist?: boolean;

    /** Focus scope label for keyboard input */
    focusLabel?: string;

    /** Called when user confirms */
    onConfirm: () => void;

    /** Called when user denies */
    onDeny: () => void;

    /** Called when user dismisses for later */
    onLater: () => void;
}

// =============================================================================
// Styling
// =============================================================================

const VARIANT_COLORS: Record<string, string> = {
    warning: 'yellow',
    info: 'blue',
    confirm: 'cyan',
};

// =============================================================================
// Component
// =============================================================================

/**
 * DismissableAlert component.
 *
 * Renders a confirmation dialog with Confirm/Later/Deny options.
 * Auto-resolves based on stored preference if set to 'always' or 'never'.
 */
export function DismissableAlert({
    alertKey,
    title,
    message,
    variant = 'confirm',
    confirmText = 'Confirm',
    denyText = 'Cancel',
    laterText = 'Remind me later',
    allowPersist = true,
    focusLabel = 'DismissableAlert',
    onConfirm,
    onDeny,
    onLater,
}: DismissableAlertProps): ReactElement | null {

    const { isFocused } = useFocusScope(focusLabel);

    const [visible, setVisible] = useState(false);
    const [selected, setSelected] = useState<0 | 1 | 2>(0); // 0=confirm, 1=later, 2=deny
    const [persistChoice, setPersistChoice] = useState(false);
    const [loading, setLoading] = useState(true);

    // Check stored preference on mount
    useEffect(() => {

        async function checkPreference(): Promise<void> {

            const pref = await getDismissablePreference(alertKey);

            if (pref === 'always') {

                onConfirm();

                return;

            }

            if (pref === 'never') {

                onDeny();

                return;

            }

            // 'ask' or undefined - show the alert
            setVisible(true);
            setLoading(false);

        }

        checkPreference();

    }, [alertKey, onConfirm, onDeny]);

    const handleSelect = useCallback(async (): Promise<void> => {

        // Persist preference if checkbox checked
        if (persistChoice && allowPersist) {

            const newPref: DismissablePreference = selected === 0 ? 'always' : 'never';
            await updateDismissablePreference(alertKey, newPref);

        }

        setVisible(false);

        if (selected === 0) {

            onConfirm();

        }
        else if (selected === 1) {

            onLater();

        }
        else {

            onDeny();

        }

    }, [selected, persistChoice, allowPersist, alertKey, onConfirm, onDeny, onLater]);

    useInput((input, key) => {

        if (!isFocused || !visible) return;

        if (key.leftArrow) {

            setSelected((s) => Math.max(0, s - 1) as 0 | 1 | 2);

        }
        else if (key.rightArrow) {

            setSelected((s) => Math.min(2, s + 1) as 0 | 1 | 2);

        }
        else if (key.return) {

            handleSelect();

        }
        else if (input === 'p' && allowPersist) {

            setPersistChoice((p) => !p);

        }
        else if (input === '1') {

            setSelected(0);
            handleSelect();

        }
        else if (input === '2') {

            setSelected(1);
            handleSelect();

        }
        else if (input === '3') {

            setSelected(2);
            handleSelect();

        }

    });

    if (loading || !visible) {

        return null;

    }

    const variantColor = VARIANT_COLORS[variant] ?? 'cyan';

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={variantColor}
            paddingX={2}
            paddingY={1}
        >
            <Text bold color={variantColor}>
                {title}
            </Text>

            <Box marginY={1}>
                <Text>{message}</Text>
            </Box>

            <Box gap={2}>
                <Text inverse={selected === 0} color={selected === 0 ? 'green' : undefined}>
                    {' '}[1] {confirmText}{' '}
                </Text>
                <Text inverse={selected === 1} color={selected === 1 ? 'yellow' : undefined}>
                    {' '}[2] {laterText}{' '}
                </Text>
                <Text inverse={selected === 2} color={selected === 2 ? 'red' : undefined}>
                    {' '}[3] {denyText}{' '}
                </Text>
            </Box>

            {allowPersist && (
                <Box marginTop={1}>
                    <Text dimColor>
                        [p] Don't ask again: {persistChoice ? '[x]' : '[ ]'}
                    </Text>
                </Box>
            )}

            <Box marginTop={1}>
                <Text dimColor>Use arrow keys or 1/2/3 to select, Enter to confirm</Text>
            </Box>
        </Box>
    );

}

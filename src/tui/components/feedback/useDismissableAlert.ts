/**
 * Hook for showing dismissable alerts imperatively.
 *
 * Returns a function that shows the alert and returns a promise
 * resolving to the user's choice. Respects stored preferences.
 *
 * @example
 * ```tsx
 * const { showAlert, alertConfig, resolveAlert } = useDismissableAlert();
 *
 * // Show alert and wait for response
 * const choice = await showAlert({
 *     alertKey: 'majorVersionUpdate',
 *     title: 'Major Update',
 *     message: 'Version 2.0.0 may include breaking changes.',
 * });
 *
 * if (choice === 'confirm') {
 *     await performUpdate();
 * }
 * ```
 */
import { useState, useCallback } from 'react';

import {
    getDismissablePreference,
    updateDismissablePreference,
} from '../../../core/update/global-settings.js';
import type { DismissablePreference } from '../../../core/update/types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * User's choice from the alert.
 */
export type AlertChoice = 'confirm' | 'deny' | 'later';

/**
 * Options for showing an alert.
 */
export interface ShowAlertOptions {
    /** Unique key for persisting preference */
    alertKey: string;

    /** Alert title */
    title: string;

    /** Alert message */
    message: string;

    /** Visual variant */
    variant?: 'warning' | 'info' | 'confirm';

    /** Text for confirm button */
    confirmText?: string;

    /** Text for deny button */
    denyText?: string;

    /** Text for later button */
    laterText?: string;

    /** Whether to show "Don't ask again" option */
    allowPersist?: boolean;
}

/**
 * Result from useDismissableAlert hook.
 */
export interface UseDismissableAlertResult {
    /** Show alert and get user choice */
    showAlert: (options: ShowAlertOptions) => Promise<AlertChoice>;

    /** Current alert config (for rendering DismissableAlert) */
    alertConfig: ShowAlertOptions | null;

    /** Resolve current alert with choice */
    resolveAlert: (choice: AlertChoice, persist?: boolean) => void;

    /** Whether an alert is currently showing */
    isShowing: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for imperative alert usage.
 *
 * Use with DismissableAlert component for rendering.
 */
export function useDismissableAlert(): UseDismissableAlertResult {

    const [alertConfig, setAlertConfig] = useState<ShowAlertOptions | null>(null);
    const [resolver, setResolver] = useState<((choice: AlertChoice) => void) | null>(null);

    const showAlert = useCallback(async (options: ShowAlertOptions): Promise<AlertChoice> => {

        // Check stored preference first
        const pref = await getDismissablePreference(options.alertKey);

        if (pref === 'always') {

            return 'confirm';

        }

        if (pref === 'never') {

            return 'deny';

        }

        // Show alert and wait for user choice
        return new Promise<AlertChoice>((resolve) => {

            setAlertConfig(options);
            setResolver(() => resolve);

        });

    }, []);

    const resolveAlert = useCallback(async (choice: AlertChoice, persist?: boolean): Promise<void> => {

        if (resolver && alertConfig) {

            // Persist if requested
            if (persist) {

                const newPref: DismissablePreference = choice === 'confirm' ? 'always' : 'never';
                await updateDismissablePreference(alertConfig.alertKey, newPref);

            }

            resolver(choice);
            setAlertConfig(null);
            setResolver(null);

        }

    }, [resolver, alertConfig]);

    return {
        showAlert,
        alertConfig,
        resolveAlert,
        isShowing: alertConfig !== null,
    };

}

/**
 * Hook for settings screen form submissions.
 *
 * Eliminates the repeated busy/error → attempt → refresh → toast → back
 * pattern found in 8+ settings screens.
 *
 * @example
 * ```typescript
 * const { execute, busy, error } = useSettingsOperation(
 *     async (mgr, data) => mgr.setBuild(data),
 *     'Build settings saved',
 * );
 *
 * // In form submit handler
 * execute(newBuildConfig);
 * ```
 */
import { useState, useCallback } from 'react';
import { attempt } from '@logosdx/utils';

import { useRouter } from '../router.js';
import { useAppContext } from '../app-context.js';
import { useToast } from '../components/index.js';
import { getErrorMessage } from '../utils/index.js';
import type { SettingsManager } from '../../core/settings/index.js';

/**
 * Options for useSettingsOperation.
 */
export interface UseSettingsOperationOptions {
    /** Whether to navigate back after success. Default: true */
    navigateBack?: boolean;
}

/**
 * Hook for settings form submission with busy/error state management.
 *
 * Handles the repeated pattern of: setBusy → attempt(operation) → refresh → toast → back.
 *
 * @param operation - Async function that receives the SettingsManager and form data
 * @param successMessage - Toast message on success (string or function of data)
 * @param options - Optional configuration
 */
export function useSettingsOperation<T>(
    operation: (mgr: SettingsManager, data: T) => Promise<void>,
    successMessage: string | ((data: T) => string),
    options?: UseSettingsOperationOptions,
): { execute: (data: T) => Promise<void>; busy: boolean; error: string | null } {

    const { back } = useRouter();
    const { settingsManager, refresh } = useAppContext();
    const { showToast } = useToast();

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const navigateBack = options?.navigateBack ?? true;

    const execute = useCallback(async (data: T) => {

        if (!settingsManager) {

            setError('Settings manager not available');

            return;

        }

        setBusy(true);
        setError(null);

        const [, err] = await attempt(async () => {

            await operation(settingsManager, data);
            await refresh();

        });

        if (err) {

            setError(getErrorMessage(err));
            setBusy(false);

            return;

        }

        const message = typeof successMessage === 'function'
            ? successMessage(data)
            : successMessage;

        showToast({ message, variant: 'success' });

        if (navigateBack) {

            back();

        }

    }, [settingsManager, refresh, showToast, back, navigateBack, operation, successMessage]);

    return { execute, busy, error };

}

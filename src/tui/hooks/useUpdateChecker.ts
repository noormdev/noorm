/**
 * Hook for background update checking.
 *
 * Spawns check in useEffect, does NOT block render.
 * Uses observer events to communicate results.
 *
 * @example
 * ```tsx
 * function App() {
 *     const { updateInfo, checking, performUpdate } = useUpdateChecker();
 *
 *     if (updateInfo?.updateAvailable) {
 *         return <UpdateBanner version={updateInfo.latestVersion} />;
 *     }
 *
 *     return <MainContent />;
 * }
 * ```
 */
import { useEffect, useState, useCallback, useRef } from 'react';

import { checkForUpdate } from '../../core/update/checker.js';
import { installUpdate } from '../../core/update/updater.js';
import { loadGlobalSettings } from '../../core/update/global-settings.js';
import type { UpdateCheckResult, UpdateResult } from '../../core/update/types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result from useUpdateChecker hook.
 */
export interface UseUpdateCheckerResult {
    /** Update check result (null while checking or if disabled/error) */
    updateInfo: UpdateCheckResult | null;

    /** Whether check is in progress */
    checking: boolean;

    /** Whether install is in progress */
    installing: boolean;

    /** Install the available update */
    performUpdate: () => Promise<UpdateResult | null>;

    /** Dismiss the update notification for this session */
    dismiss: () => void;

    /** Whether the update was dismissed */
    dismissed: boolean;

    /** Trigger a manual update check */
    recheckForUpdate: () => Promise<void>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for background update checking.
 *
 * Checks global settings on mount and runs update check if enabled.
 * Does not auto-install updates - that logic is handled by the consuming component.
 */
export function useUpdateChecker(): UseUpdateCheckerResult {

    const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    // Track if component is mounted to avoid state updates after unmount
    const mountedRef = useRef(true);

    useEffect(() => {

        mountedRef.current = true;

        return () => {

            mountedRef.current = false;

        };

    }, []);

    // Perform update check
    const doCheck = useCallback(async (): Promise<void> => {

        const settings = await loadGlobalSettings();

        // Respect user preference
        if (!settings.checkUpdates) {

            return;

        }

        setChecking(true);

        const result = await checkForUpdate();

        if (!mountedRef.current) return;

        setChecking(false);
        setUpdateInfo(result);

    }, []);

    // Background check on mount
    useEffect(() => {

        doCheck();

    }, [doCheck]);

    // Install update
    const performUpdate = useCallback(async (): Promise<UpdateResult | null> => {

        if (!updateInfo?.updateAvailable) {

            return null;

        }

        setInstalling(true);

        const result = await installUpdate(updateInfo.latestVersion);

        if (mountedRef.current) {

            setInstalling(false);

        }

        return result;

    }, [updateInfo]);

    // Dismiss notification for this session
    const dismiss = useCallback((): void => {

        setDismissed(true);

    }, []);

    // Manual recheck
    const recheckForUpdate = useCallback(async (): Promise<void> => {

        setDismissed(false);
        await doCheck();

    }, [doCheck]);

    return {
        updateInfo: dismissed ? null : updateInfo,
        checking,
        installing,
        performUpdate,
        dismiss,
        dismissed,
        recheckForUpdate,
    };

}

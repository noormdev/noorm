/**
 * Tests for useUpdateChecker hook.
 *
 * Tests the background update checking functionality.
 * Uses ink-testing-library with a wrapper component.
 */
import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi, mock } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

import { useUpdateChecker, type UseUpdateCheckerResult } from '../../../src/cli/hooks/useUpdateChecker.js';
import type { UpdateCheckResult, GlobalSettings } from '../../../src/core/update/types.js';

// Mock the core modules
mock.module('../../../src/core/update/checker.js', () => ({
    checkForUpdate: vi.fn(),
    getCurrentVersion: vi.fn(() => '1.0.0'),
}));

mock.module('../../../src/core/update/updater.js', () => ({
    installUpdate: vi.fn(),
}));

mock.module('../../../src/core/update/global-settings.js', () => ({
    loadGlobalSettings: vi.fn(),
}));

// Import mocked modules
import { checkForUpdate } from '../../../src/core/update/checker.js';
import { installUpdate } from '../../../src/core/update/updater.js';
import { loadGlobalSettings } from '../../../src/core/update/global-settings.js';

/**
 * Test wrapper component that exposes hook state.
 */
function TestComponent({ onResult }: { onResult: (result: UseUpdateCheckerResult) => void }) {

    const result = useUpdateChecker();

    useEffect(() => {

        onResult(result);

    }, [result, onResult]);

    return (
        <Text>
            {result.checking ? 'checking' : 'idle'}
            {result.updateInfo?.updateAvailable ? ' update-available' : ''}
            {result.dismissed ? ' dismissed' : ''}
        </Text>
    );

}

describe('cli: useUpdateChecker', () => {

    let latestResult: UseUpdateCheckerResult | null = null;

    const captureResult = (result: UseUpdateCheckerResult) => {

        latestResult = result;

    };

    beforeEach(() => {

        vi.clearAllMocks();
        latestResult = null;

        // Default mock implementations
        (loadGlobalSettings as any).mockResolvedValue({
            checkUpdates: true,
            autoUpdate: false,
        } as GlobalSettings);

    });

    afterEach(() => {

        vi.restoreAllMocks();

    });

    it('should check for updates on mount', async () => {

        const mockResult: UpdateCheckResult = {
            currentVersion: '1.0.0',
            latestVersion: '1.1.0',
            updateAvailable: true,
            isMajorUpdate: false,
            isPrerelease: false,
        };

        (checkForUpdate as any).mockResolvedValue(mockResult);

        const { lastFrame, unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(lastFrame()).toContain('update-available');
        expect(latestResult?.updateInfo?.latestVersion).toBe('1.1.0');

        unmount();

    });

    it('should not check when disabled in settings', async () => {

        (loadGlobalSettings as any).mockResolvedValue({
            checkUpdates: false,
            autoUpdate: false,
        } as GlobalSettings);

        const { unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(checkForUpdate).not.toHaveBeenCalled();

        unmount();

    });

    it('should handle null result (offline/error)', async () => {

        (checkForUpdate as any).mockResolvedValue(null);

        const { lastFrame, unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(lastFrame()).toContain('idle');
        expect(latestResult?.updateInfo).toBeNull();
        expect(latestResult?.checking).toBe(false);

        unmount();

    });

    it('should set checking state during check', async () => {

        let resolveCheck: ((value: UpdateCheckResult | null) => void) | undefined;

        (checkForUpdate as any).mockImplementation(() => {

            return new Promise((resolve) => {

                resolveCheck = resolve;

            });

        });

        const { lastFrame, unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('checking');

        resolveCheck?.({
            currentVersion: '1.0.0',
            latestVersion: '1.0.0',
            updateAvailable: false,
            isMajorUpdate: false,
            isPrerelease: false,
        });

        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('idle');

        unmount();

    });

    it('should perform update when requested', async () => {

        const mockCheckResult: UpdateCheckResult = {
            currentVersion: '1.0.0',
            latestVersion: '1.1.0',
            updateAvailable: true,
            isMajorUpdate: false,
            isPrerelease: false,
        };

        (checkForUpdate as any).mockResolvedValue(mockCheckResult);
        (installUpdate as any).mockResolvedValue({
            success: true,
            previousVersion: '1.0.0',
            newVersion: '1.1.0',
        });

        const { unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(latestResult?.updateInfo).not.toBeNull();

        const updateResult = await latestResult?.performUpdate();

        expect(installUpdate).toHaveBeenCalledWith('1.1.0');
        expect(updateResult?.success).toBe(true);

        unmount();

    });

    it('should not perform update when no update available', async () => {

        (checkForUpdate as any).mockResolvedValue({
            currentVersion: '1.0.0',
            latestVersion: '1.0.0',
            updateAvailable: false,
            isMajorUpdate: false,
            isPrerelease: false,
        });

        const { unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        const updateResult = await latestResult?.performUpdate();

        expect(installUpdate).not.toHaveBeenCalled();
        expect(updateResult).toBeNull();

        unmount();

    });

    it('should dismiss update notification', async () => {

        (checkForUpdate as any).mockResolvedValue({
            currentVersion: '1.0.0',
            latestVersion: '1.1.0',
            updateAvailable: true,
            isMajorUpdate: false,
            isPrerelease: false,
        });

        const { lastFrame, unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(latestResult?.updateInfo).not.toBeNull();

        latestResult?.dismiss();

        await new Promise((r) => setTimeout(r, 50));

        expect(lastFrame()).toContain('dismissed');
        expect(latestResult?.updateInfo).toBeNull(); // Returns null when dismissed

        unmount();

    });

});

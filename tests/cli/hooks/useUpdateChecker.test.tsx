/**
 * Tests for useUpdateChecker hook.
 *
 * Tests the background update checking functionality.
 * Uses ink-testing-library with a wrapper component.
 */
import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

import { useUpdateChecker, type UseUpdateCheckerResult } from '../../../src/cli/hooks/useUpdateChecker.js';
import type { UpdateCheckResult, GlobalSettings } from '../../../src/core/update/types.js';

// Mock the core modules
vi.mock('../../../src/core/update/checker.js', () => ({
    checkForUpdate: vi.fn(),
    getCurrentVersion: vi.fn(() => '1.0.0'),
}));

vi.mock('../../../src/core/update/updater.js', () => ({
    installUpdate: vi.fn(),
}));

vi.mock('../../../src/core/update/global-settings.js', () => ({
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
        vi.mocked(loadGlobalSettings).mockResolvedValue({
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

        vi.mocked(checkForUpdate).mockResolvedValue(mockResult);

        const { lastFrame, unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(lastFrame()).toContain('update-available');
        expect(latestResult?.updateInfo?.latestVersion).toBe('1.1.0');

        unmount();

    });

    it('should not check when disabled in settings', async () => {

        vi.mocked(loadGlobalSettings).mockResolvedValue({
            checkUpdates: false,
            autoUpdate: false,
        } as GlobalSettings);

        const { unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(checkForUpdate).not.toHaveBeenCalled();

        unmount();

    });

    it('should handle null result (offline/error)', async () => {

        vi.mocked(checkForUpdate).mockResolvedValue(null);

        const { lastFrame, unmount } = render(<TestComponent onResult={captureResult} />);

        await new Promise((r) => setTimeout(r, 150));

        expect(lastFrame()).toContain('idle');
        expect(latestResult?.updateInfo).toBeNull();
        expect(latestResult?.checking).toBe(false);

        unmount();

    });

    it('should set checking state during check', async () => {

        let resolveCheck: ((value: UpdateCheckResult | null) => void) | undefined;

        vi.mocked(checkForUpdate).mockImplementation(() => {

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

        vi.mocked(checkForUpdate).mockResolvedValue(mockCheckResult);
        vi.mocked(installUpdate).mockResolvedValue({
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

        vi.mocked(checkForUpdate).mockResolvedValue({
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

        vi.mocked(checkForUpdate).mockResolvedValue({
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

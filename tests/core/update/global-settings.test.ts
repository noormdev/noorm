/**
 * Tests for global settings manager.
 *
 * Tests the ~/.noorm/settings.yml management functionality.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
    loadGlobalSettings,
    saveGlobalSettings,
    updateGlobalSetting,
    updateDismissablePreference,
    getDismissablePreference,
    getGlobalSettingsPath,
    resetGlobalSettingsForTesting,
    setTestOverridePath,
} from '../../../src/core/update/global-settings.js';
import type { GlobalSettings } from '../../../src/core/update/types.js';

describe('update: global-settings', () => {

    let tempDir: string;

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-test-'));
        resetGlobalSettingsForTesting();
        setTestOverridePath(tempDir);

    });

    afterEach(async () => {

        resetGlobalSettingsForTesting();
        await rm(tempDir, { recursive: true, force: true });

    });

    describe('loadGlobalSettings', () => {

        it('should return defaults when file does not exist', async () => {

            const settings = await loadGlobalSettings();

            expect(settings.checkUpdates).toBe(true);
            expect(settings.autoUpdate).toBe(false);

        });

        it('should load settings from existing file', async () => {

            // Write a settings file first
            await saveGlobalSettings({
                checkUpdates: false,
                autoUpdate: true,
            });

            // Reload
            const settings = await loadGlobalSettings();

            expect(settings.checkUpdates).toBe(false);
            expect(settings.autoUpdate).toBe(true);

        });

        it('should merge with defaults for missing fields', async () => {

            // Write partial settings
            await saveGlobalSettings({
                checkUpdates: false,
            } as GlobalSettings);

            const settings = await loadGlobalSettings();

            expect(settings.checkUpdates).toBe(false);
            expect(settings.autoUpdate).toBe(false); // Default

        });

        it('should handle empty file', async () => {

            // Create empty file
            const { writeFile } = await import('fs/promises');
            await writeFile(join(tempDir, 'settings.yml'), '');

            const settings = await loadGlobalSettings();

            expect(settings.checkUpdates).toBe(true);
            expect(settings.autoUpdate).toBe(false);

        });

    });

    describe('saveGlobalSettings', () => {

        it('should create settings file', async () => {

            await saveGlobalSettings({
                checkUpdates: true,
                autoUpdate: true,
            });

            const content = await readFile(join(tempDir, 'settings.yml'), 'utf8');

            expect(content).toContain('checkUpdates: true');
            expect(content).toContain('autoUpdate: true');

        });

        it('should preserve all fields', async () => {

            const settings: GlobalSettings = {
                checkUpdates: false,
                autoUpdate: true,
                lastCheck: '2025-01-01T00:00:00.000Z',
                cachedVersion: '1.2.0',
                dismissable: {
                    majorVersionUpdate: 'always',
                },
            };

            await saveGlobalSettings(settings);

            const loaded = await loadGlobalSettings();

            expect(loaded.checkUpdates).toBe(false);
            expect(loaded.autoUpdate).toBe(true);
            expect(loaded.lastCheck).toBe('2025-01-01T00:00:00.000Z');
            expect(loaded.cachedVersion).toBe('1.2.0');
            expect(loaded.dismissable?.majorVersionUpdate).toBe('always');

        });

    });

    describe('updateGlobalSetting', () => {

        it('should update single setting', async () => {

            await updateGlobalSetting('autoUpdate', true);

            const settings = await loadGlobalSettings();

            expect(settings.autoUpdate).toBe(true);
            expect(settings.checkUpdates).toBe(true); // Default preserved

        });

        it('should preserve other settings', async () => {

            await saveGlobalSettings({
                checkUpdates: false,
                autoUpdate: false,
            });

            await updateGlobalSetting('autoUpdate', true);

            const settings = await loadGlobalSettings();

            expect(settings.autoUpdate).toBe(true);
            expect(settings.checkUpdates).toBe(false); // Preserved

        });

    });

    describe('dismissable preferences', () => {

        it('should update dismissable preference', async () => {

            await updateDismissablePreference('majorVersionUpdate', 'always');

            const settings = await loadGlobalSettings();

            expect(settings.dismissable?.majorVersionUpdate).toBe('always');

        });

        it('should get dismissable preference', async () => {

            await updateDismissablePreference('testAlert', 'never');

            const pref = await getDismissablePreference('testAlert');

            expect(pref).toBe('never');

        });

        it('should return ask for unknown alert', async () => {

            const pref = await getDismissablePreference('unknownAlert');

            expect(pref).toBe('ask');

        });

        it('should handle multiple dismissable preferences', async () => {

            await updateDismissablePreference('alert1', 'always');
            await updateDismissablePreference('alert2', 'never');
            await updateDismissablePreference('alert3', 'ask');

            const pref1 = await getDismissablePreference('alert1');
            const pref2 = await getDismissablePreference('alert2');
            const pref3 = await getDismissablePreference('alert3');

            expect(pref1).toBe('always');
            expect(pref2).toBe('never');
            expect(pref3).toBe('ask');

        });

    });

    describe('getGlobalSettingsPath', () => {

        it('should return test override path when set', () => {

            const path = getGlobalSettingsPath();

            expect(path).toBe(join(tempDir, 'settings.yml'));

        });

    });

});

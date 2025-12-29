/**
 * Tests for settings version manager.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { observer } from '../../../src/core/observer.js';
import { CURRENT_VERSIONS, VersionMismatchError } from '../../../src/core/version/types.js';
import {
    getSettingsVersion,
    checkSettingsVersion,
    needsSettingsMigration,
    migrateSettings,
    createEmptyVersionedSettings,
    ensureSettingsVersion,
} from '../../../src/core/version/settings/index.js';

describe('version: settings', () => {

    beforeEach(() => {

        observer.clear();

    });

    describe('getSettingsVersion', () => {

        it('should return schemaVersion from settings', () => {

            const settings = { schemaVersion: 3 };

            expect(getSettingsVersion(settings)).toBe(3);

        });

        it('should return 0 for missing schemaVersion', () => {

            const settings = {};

            expect(getSettingsVersion(settings)).toBe(0);

        });

        it('should return 0 for non-number schemaVersion', () => {

            const settings = { schemaVersion: '1' };

            expect(getSettingsVersion(settings)).toBe(0);

        });

        it('should return 0 for null schemaVersion', () => {

            const settings = { schemaVersion: null };

            expect(getSettingsVersion(settings)).toBe(0);

        });

    });

    describe('checkSettingsVersion', () => {

        it('should return current and expected versions', () => {

            const settings = { schemaVersion: 1 };
            const status = checkSettingsVersion(settings);

            expect(status.current).toBe(1);
            expect(status.expected).toBe(CURRENT_VERSIONS.settings);

        });

        it('should detect migration needed when current < expected', () => {

            const settings = { schemaVersion: 0 };
            const status = checkSettingsVersion(settings);

            expect(status.needsMigration).toBe(true);
            expect(status.isNewer).toBe(false);

        });

        it('should detect newer version when current > expected', () => {

            const settings = { schemaVersion: 999 };
            const status = checkSettingsVersion(settings);

            expect(status.isNewer).toBe(true);
            expect(status.needsMigration).toBe(false);

        });

        it('should detect no migration needed when current == expected', () => {

            const settings = { schemaVersion: CURRENT_VERSIONS.settings };
            const status = checkSettingsVersion(settings);

            expect(status.needsMigration).toBe(false);
            expect(status.isNewer).toBe(false);

        });

    });

    describe('needsSettingsMigration', () => {

        it('should return true when migration needed', () => {

            const settings = { schemaVersion: 0 };

            expect(needsSettingsMigration(settings)).toBe(true);

        });

        it('should return false when no migration needed', () => {

            const settings = { schemaVersion: CURRENT_VERSIONS.settings };

            expect(needsSettingsMigration(settings)).toBe(false);

        });

        it('should return false when version is newer', () => {

            const settings = { schemaVersion: 999 };

            expect(needsSettingsMigration(settings)).toBe(false);

        });

    });

    describe('migrateSettings', () => {

        it('should migrate unversioned settings to current version', () => {

            const settings = {};
            const migrated = migrateSettings(settings);

            expect(migrated['schemaVersion']).toBe(CURRENT_VERSIONS.settings);

        });

        it('should preserve existing settings', () => {

            const settings = {
                build: { include: ['schema'] },
                paths: { schema: 'sql' },
            };
            const migrated = migrateSettings(settings);

            expect(migrated['build']).toEqual({ include: ['schema'] });
            expect(migrated['paths']).toEqual({ schema: 'sql' });

        });

        it('should return same settings if already current version', () => {

            const settings = { schemaVersion: CURRENT_VERSIONS.settings };
            const migrated = migrateSettings(settings);

            expect(migrated).toBe(settings);

        });

        it('should throw VersionMismatchError for newer version', () => {

            const settings = { schemaVersion: 999 };

            expect(() => migrateSettings(settings)).toThrow(VersionMismatchError);

        });

        it('should emit version:settings:migrating event', () => {

            const events: unknown[] = [];
            observer.on('version:settings:migrating', (data) => events.push(data));

            const settings = {};
            migrateSettings(settings);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                from: 0,
                to: CURRENT_VERSIONS.settings,
            });

        });

        it('should emit version:settings:migrated event', () => {

            const events: unknown[] = [];
            observer.on('version:settings:migrated', (data) => events.push(data));

            const settings = {};
            migrateSettings(settings);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                from: 0,
                to: CURRENT_VERSIONS.settings,
            });

        });

        it('should emit version:mismatch event for newer version', () => {

            const events: unknown[] = [];
            observer.on('version:mismatch', (data) => events.push(data));

            const settings = { schemaVersion: 999 };

            try {

                migrateSettings(settings);

            }
            catch {
                // Expected
            }

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                layer: 'settings',
                current: 999,
                expected: CURRENT_VERSIONS.settings,
            });

        });

        it('should not mutate original settings', () => {

            const settings = { build: { include: ['a'] } };
            const migrated = migrateSettings(settings);

            expect(settings).not.toHaveProperty('schemaVersion');
            expect(migrated).toHaveProperty('schemaVersion');

        });

    });

    describe('createEmptyVersionedSettings', () => {

        it('should create settings with current version', () => {

            const settings = createEmptyVersionedSettings();

            expect(settings['schemaVersion']).toBe(CURRENT_VERSIONS.settings);

        });

        it('should have minimal structure', () => {

            const settings = createEmptyVersionedSettings();

            // v1 only adds schemaVersion, other fields are optional
            expect(Object.keys(settings)).toContain('schemaVersion');

        });

    });

    describe('ensureSettingsVersion', () => {

        it('should migrate if needed', () => {

            const settings = {};
            const result = ensureSettingsVersion(settings);

            expect(result['schemaVersion']).toBe(CURRENT_VERSIONS.settings);

        });

        it('should return same settings if already current', () => {

            const settings = { schemaVersion: CURRENT_VERSIONS.settings };
            const result = ensureSettingsVersion(settings);

            expect(result).toBe(settings);

        });

        it('should throw for newer version', () => {

            const settings = { schemaVersion: 999 };

            expect(() => ensureSettingsVersion(settings)).toThrow(VersionMismatchError);

        });

    });

});

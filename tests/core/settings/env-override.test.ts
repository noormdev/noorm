/**
 * Tests that NOORM_* env vars override settings loaded from YAML.
 *
 * Verifies the unified mental model: NOORM_PATHS_SQL in env
 * is equivalent to paths.sql in settings.yml.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SettingsManager, resetSettingsManager } from '../../../src/core/settings/manager.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('settings: env overrides', () => {

    let testDir: string;
    const envBackup: Record<string, string | undefined> = {};

    const ENV_VARS_TO_CLEAN = [
        'NOORM_PATHS_SQL',
        'NOORM_PATHS_CHANGES',
        'NOORM_LOGGING_LEVEL',
        'NOORM_CONFIG',
        'NOORM_YES',
        'NOORM_JSON',
    ];

    beforeEach(async () => {

        testDir = join(tmpdir(), `noorm-settings-env-${Date.now()}`);
        await mkdir(join(testDir, '.noorm'), { recursive: true });

        for (const key of ENV_VARS_TO_CLEAN) {

            envBackup[key] = process.env[key];
            delete process.env[key];

        }

        resetSettingsManager();

    });

    afterEach(async () => {

        for (const [key, value] of Object.entries(envBackup)) {

            if (value === undefined) {

                delete process.env[key];

            }
            else {

                process.env[key] = value;

            }

        }

        resetSettingsManager();
        await rm(testDir, { recursive: true, force: true });

    });

    it('should override paths from env vars when YAML exists', async () => {

        const yaml = 'paths:\n    sql: ./sql\n    changes: ./changes\n';
        await writeFile(join(testDir, '.noorm', 'settings.yml'), yaml);

        process.env['NOORM_PATHS_SQL'] = './custom/sql';

        const manager = new SettingsManager(testDir);
        const settings = await manager.load();

        expect(settings.paths?.sql).toBe('./custom/sql');
        expect(settings.paths?.changes).toBe('./changes');

    });

    it('should apply env vars when no YAML file exists', async () => {

        process.env['NOORM_PATHS_SQL'] = './ci/sql';
        process.env['NOORM_PATHS_CHANGES'] = './ci/changes';

        const manager = new SettingsManager(testDir);
        const settings = await manager.load();

        expect(settings.paths?.sql).toBe('./ci/sql');
        expect(settings.paths?.changes).toBe('./ci/changes');

    });

    it('should apply env vars when YAML file is empty', async () => {

        await writeFile(join(testDir, '.noorm', 'settings.yml'), '');

        process.env['NOORM_PATHS_SQL'] = './empty/sql';

        const manager = new SettingsManager(testDir);
        const settings = await manager.load();

        expect(settings.paths?.sql).toBe('./empty/sql');

    });

    it('should not include meta env vars in settings', async () => {

        process.env['NOORM_CONFIG'] = 'staging';
        process.env['NOORM_YES'] = 'true';

        const manager = new SettingsManager(testDir);
        const settings = await manager.load();

        expect((settings as Record<string, unknown>)['config']).toBeUndefined();
        expect((settings as Record<string, unknown>)['yes']).toBeUndefined();

    });

});

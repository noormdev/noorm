/**
 * Tests that NOORM_* env vars override settings loaded from YAML.
 *
 * Verifies the unified mental model: NOORM_PATHS_SQL in env
 * is equivalent to paths.sql in settings.yml.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SettingsManager, resetSettingsManager } from '../../../src/core/settings/manager.js';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
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
        'NOORM_VAULT_TOKEN',
        'NOORM_DB_PASSWORD',
        'NOORM_API_KEY',
        'NOORM_FOO_BAR',
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

    /**
     * settings.yml is version controlled by design. The env overlay is a
     * per-process view of settings — persisting it launders whatever the
     * shell happened to export (vault tokens, DB passwords) into a file
     * that gets committed. These assert the overlay never reaches disk,
     * while staying readable at runtime.
     */
    describe('env overlay is never persisted', () => {

        const settingsPath = () => join(testDir, '.noorm', 'settings.yml');

        it('should not write ambient NOORM_* secrets to settings.yml on save', async () => {

            await writeFile(settingsPath(), 'paths:\n    sql: ./sql\n');

            process.env['NOORM_VAULT_TOKEN'] = 'hvs.SUPERSECRETVAULTTOKEN';
            process.env['NOORM_DB_PASSWORD'] = 'pgpassword123';
            process.env['NOORM_API_KEY'] = 'sk-live-abcdef';

            const manager = new SettingsManager(testDir);
            await manager.load();
            await manager.save();

            const onDisk = await readFile(settingsPath(), 'utf-8');

            expect(onDisk).not.toContain('hvs.SUPERSECRETVAULTTOKEN');
            expect(onDisk).not.toContain('pgpassword123');
            expect(onDisk).not.toContain('sk-live-abcdef');

        });

        it('should not write env-derived keys when an unrelated section is mutated', async () => {

            await writeFile(settingsPath(), 'paths:\n    sql: ./sql\n');

            process.env['NOORM_DB_PASSWORD'] = 'pgpassword123';
            process.env['NOORM_FOO_BAR'] = 'leaked';

            const manager = new SettingsManager(testDir);
            await manager.load();

            // Every mutator calls save(); editing build must not drag env in.
            await manager.setBuild({ include: ['schema'], exclude: [] });

            const onDisk = await readFile(settingsPath(), 'utf-8');

            expect(onDisk).not.toContain('pgpassword123');
            expect(onDisk).not.toContain('leaked');
            expect(onDisk).toContain('schema');

        });

        it('should keep the committed value on disk when env overrides it at runtime', async () => {

            await writeFile(settingsPath(), 'paths:\n    sql: ./sql\n    changes: ./changes\n');

            process.env['NOORM_PATHS_SQL'] = './ci-sql';

            const manager = new SettingsManager(testDir);
            await manager.load();

            // The overlay is what callers execute against ...
            expect(manager.getPaths().sql).toBe('./ci-sql');

            await manager.setBuild({ include: ['schema'], exclude: [] });

            // ... but the file keeps what a human put there.
            const onDisk = await readFile(settingsPath(), 'utf-8');

            expect(onDisk).toContain('./sql');
            expect(onDisk).not.toContain('./ci-sql');

        });

        it('should still expose env overrides through accessors after a save', async () => {

            await writeFile(settingsPath(), 'paths:\n    sql: ./sql\n');

            process.env['NOORM_PATHS_SQL'] = './ci-sql';

            const manager = new SettingsManager(testDir);
            await manager.load();
            await manager.setBuild({ include: ['schema'], exclude: [] });

            expect(manager.getPaths().sql).toBe('./ci-sql');
            expect(manager.getBuild().include).toEqual(['schema']);

        });

    });

});

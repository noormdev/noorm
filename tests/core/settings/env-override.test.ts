/**
 * Tests that NOORM_* env vars override settings loaded from YAML.
 *
 * Verifies the unified mental model: NOORM_PATHS_SQL in env
 * is equivalent to paths.sql in settings.yml.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SettingsManager, resetSettingsManager } from '../../../src/core/settings/manager.js';
import { getEnvConfig } from '../../../src/core/config/index.js';
import { parseConfig } from '../../../src/core/config/schema.js';
import { SettingsProvider, withConfigPolicy } from '../../../src/core/config/resolver.js';
import { getConfigPermission } from '../../../src/core/policy/index.js';
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
        'NOORM_BUILD_INCLUDE',
        'NOORM_ACCESS_ROLES_ANALYST_EXTENDS',
        'NOORM_ACCESS_USER',
        'NOORM_ACCESS_AGENT',
        'NOORM_ACCESS_OTHER',
        'NOORM_STAGES_PROD_DEFAULTS_PROTECTED',
        'NOORM_STAGES_prod_defaults.protected',
        'NOORM_STAGES.prod.defaults.protected',
        'NOORM_ACCESS.roles.rogue.permissions.sql:ddl',
        'NOORM_access.roles.rogue.permissions.sql:ddl',
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

    it('keeps config access assignments out of settings without suppressing config env parsing', async () => {

        await writeFile(
            join(testDir, '.noorm', 'settings.yml'),
            'access:\n  roles:\n    analyst:\n      extends: viewer\n',
        );
        process.env['NOORM_ACCESS_USER'] = 'analyst';
        process.env['NOORM_ACCESS_AGENT'] = 'viewer';
        process.env['NOORM_ACCESS_OTHER'] = 'ignored';

        const settings = await new SettingsManager(testDir).load();
        expect(settings.access).toEqual({ roles: { analyst: { extends: 'viewer' } } });
        expect(getEnvConfig().access).toMatchObject({ user: 'analyst', agent: 'viewer' });

    });

    it.each([
        'NOORM_STAGES_PROD_DEFAULTS_PROTECTED',
        'NOORM_STAGES_prod_defaults.protected',
        'NOORM_STAGES.prod.defaults.protected',
    ])('keeps the protected-stage ceiling under environment key %s', async (key) => {

        await writeFile(join(testDir, '.noorm', 'settings.yml'),
            'stages:\n  prod:\n    defaults:\n      protected: true\n');
        process.env[key] = 'false';

        const manager = new SettingsManager(testDir);
        await manager.load();
        const config = withConfigPolicy(parseConfig({
            name: 'prod', type: 'local',
            connection: { dialect: 'sqlite', database: ':memory:' },
            access: { user: 'admin', agent: 'admin' },
        }), new SettingsProvider(manager));
        expect(getConfigPermission('agent', config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('user', config, 'db:destroy')).toBe('deny');

    });

    it.each([
        'NOORM_ACCESS.roles.rogue.permissions.sql:ddl',
        'NOORM_access.roles.rogue.permissions.sql:ddl',
    ])('does not introduce role definitions through environment key %s', async (key) => {

        process.env[key] = 'allow';
        const settings = await new SettingsManager(testDir).load();
        expect(settings.access).toBeUndefined();

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
     * The overlay is merged after parseSettings, so nothing type-checked it.
     * A scalar landing in an array field was iterated character by character:
     * `NOORM_BUILD_INCLUDE=00_tables` became ['0','0','_','t',...], matched
     * no files, and still reported success with exit 0.
     */
    it('should reject a scalar env value where the schema wants an array', async () => {

        process.env['NOORM_BUILD_INCLUDE'] = '00_tables';

        const manager = new SettingsManager(testDir);

        let caught: Error | null = null;

        await manager.load().catch((err: Error) => {

            caught = err;

        });

        expect(caught).not.toBeNull();
        expect((caught as unknown as Error).message).toMatch(/array/i);

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

        it('ignores role-definition environment overrides and preserves committed roles across writes', async () => {

            await writeFile(settingsPath(), [
                'access:',
                '  roles:',
                '    analyst:',
                '      extends: viewer',
                '      permissions:',
                '        sql:read: allow',
                '',
            ].join('\n'));
            process.env['NOORM_ACCESS_ROLES_ANALYST_EXTENDS'] = 'operator';

            const manager = new SettingsManager(testDir);
            const settings = await manager.load();
            expect(settings.access?.roles?.['analyst']).toEqual({
                extends: 'viewer',
                permissions: { 'sql:read': 'allow' },
            });

            await manager.setBuild({ include: ['schema'], exclude: [] });
            const saved = await readFile(settingsPath(), 'utf-8');
            expect(saved).toContain('viewer');
            expect(saved).toContain('sql:read');
            expect(saved).not.toContain('operator');
            expect((await manager.load()).access?.roles?.['analyst']?.extends).toBe('viewer');

        });

        it('does not create roles from the environment when no roles are committed', async () => {

            await writeFile(settingsPath(), '{}');
            process.env['NOORM_ACCESS_ROLES_ANALYST_EXTENDS'] = 'admin';

            const manager = new SettingsManager(testDir);
            expect((await manager.load()).access?.roles).toBeUndefined();

        });

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

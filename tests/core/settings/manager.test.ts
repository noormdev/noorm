import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
    SettingsManager,
    resetSettingsManager,
    DEFAULT_SETTINGS,
} from '../../../src/core/settings/index.js';

import type { Stage, Rule } from '../../../src/core/settings/types.js';

/**
 * Creates a fresh test context for each test.
 */
function createTestContext() {

    resetSettingsManager();

    const tempDir = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-settings-test-'));
    const manager = new SettingsManager(tempDir, {
        settingsDir: '.test-settings',
        settingsFile: 'settings.yml',
    });

    const cleanup = () => {

        resetSettingsManager();

        if (existsSync(tempDir)) {

            rmSync(tempDir, { recursive: true });

        }

    };

    return { tempDir, manager, cleanup };

}

describe('settings: SettingsManager', () => {

    describe('load', () => {

        it('should return defaults when file does not exist', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                const settings = await manager.load();

                expect(settings).toEqual(DEFAULT_SETTINGS);
                expect(manager.isLoaded).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should load settings from existing file', async () => {

            const { tempDir, manager, cleanup } = createTestContext();

            try {

                const settingsDir = join(tempDir, '.test-settings');
                mkdirSync(settingsDir, { recursive: true });

                const yaml = `
build:
    include:
        - sql/custom
    exclude:
        - sql/ignored
`;
                writeFileSync(join(settingsDir, 'settings.yml'), yaml);

                const settings = await manager.load();

                expect(settings.build?.include).toEqual(['sql/custom']);
                expect(settings.build?.exclude).toEqual(['sql/ignored']);

            }
            finally {

                cleanup();

            }

        });

        it('should handle empty file', async () => {

            const { tempDir, manager, cleanup } = createTestContext();

            try {

                const settingsDir = join(tempDir, '.test-settings');
                mkdirSync(settingsDir, { recursive: true });
                writeFileSync(join(settingsDir, 'settings.yml'), '');

                const settings = await manager.load();

                expect(settings).toEqual(DEFAULT_SETTINGS);

            }
            finally {

                cleanup();

            }

        });

        it('should throw on invalid YAML', async () => {

            const { tempDir, manager, cleanup } = createTestContext();

            try {

                const settingsDir = join(tempDir, '.test-settings');
                mkdirSync(settingsDir, { recursive: true });
                writeFileSync(join(settingsDir, 'settings.yml'), 'invalid: yaml: content: [');

                await expect(manager.load()).rejects.toThrow('Invalid YAML');

            }
            finally {

                cleanup();

            }

        });

        it('should throw on invalid schema', async () => {

            const { tempDir, manager, cleanup } = createTestContext();

            try {

                const settingsDir = join(tempDir, '.test-settings');
                mkdirSync(settingsDir, { recursive: true });

                const yaml = `
stages:
    dev:
        defaults:
            dialect: oracle
`;
                writeFileSync(join(settingsDir, 'settings.yml'), yaml);

                await expect(manager.load()).rejects.toThrow();

            }
            finally {

                cleanup();

            }

        });

    });

    describe('save', () => {

        it('should create settings directory and file', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.save();

                expect(existsSync(manager.settingsFilePath)).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should persist settings to YAML', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setBuild({ include: ['custom/path'] });

                const content = readFileSync(manager.settingsFilePath, 'utf-8');

                expect(content).toContain('custom/path');

            }
            finally {

                cleanup();

            }

        });

        it('should throw if not loaded', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await expect(manager.save()).rejects.toThrow('not loaded');

            }
            finally {

                cleanup();

            }

        });

    });

    describe('init', () => {

        it('should create settings file with defaults', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.init();

                expect(existsSync(manager.settingsFilePath)).toBe(true);
                expect(manager.isLoaded).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should throw if file exists without force', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.init();

                await expect(manager.init()).rejects.toThrow('already exists');

            }
            finally {

                cleanup();

            }

        });

        it('should overwrite with force=true', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.init();
                await manager.setBuild({ include: ['modified'] });

                await manager.init(true);

                // Force reinit should reset to defaults (empty array, not 'modified')
                expect(manager.getBuild().include).toEqual([]);

            }
            finally {

                cleanup();

            }

        });

    });

    describe('exists', () => {

        it('should return false when file does not exist', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                expect(await manager.exists()).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should return true when file exists', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.init();

                expect(await manager.exists()).toBe(true);

            }
            finally {

                cleanup();

            }

        });

    });

    describe('accessors', () => {

        it('should throw if not loaded', () => {

            const { manager, cleanup } = createTestContext();

            try {

                expect(() => manager.settings).toThrow('not loaded');
                expect(() => manager.getBuild()).toThrow('not loaded');
                expect(() => manager.getPaths()).toThrow('not loaded');

            }
            finally {

                cleanup();

            }

        });

        it('should return build config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const build = manager.getBuild();

                expect(build.include).toBeDefined();

            }
            finally {

                cleanup();

            }

        });

        it('should return paths config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const paths = manager.getPaths();

                expect(paths.sql).toBe('./sql');
                expect(paths.changes).toBe('./changes');

            }
            finally {

                cleanup();

            }

        });

        it('should return rules', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const rules = manager.getRules();

                expect(Array.isArray(rules)).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should return stages', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const stages = manager.getStages();

                expect(typeof stages).toBe('object');

            }
            finally {

                cleanup();

            }

        });

        it('should return strict config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const strict = manager.getStrict();

                expect(strict.enabled).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should return logging config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const logging = manager.getLogging();

                expect(logging.enabled).toBe(true);
                expect(logging.level).toBe('info');

            }
            finally {

                cleanup();

            }

        });

    });

    describe('stage operations', () => {

        const testStage: Stage = {
            description: 'Test stage',
            locked: true,
            defaults: {
                dialect: 'postgres',
                protected: true,
            },
            secrets: [{ key: 'DB_PASSWORD', type: 'password' }],
        };

        it('should set and get a stage', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', testStage);

                const stage = manager.getStage('prod');

                expect(stage).toEqual(testStage);

            }
            finally {

                cleanup();

            }

        });

        it('should check if stage exists', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                expect(manager.hasStage('prod')).toBe(false);

                await manager.setStage('prod', testStage);

                expect(manager.hasStage('prod')).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should remove a stage', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', testStage);

                const removed = await manager.removeStage('prod');

                expect(removed).toBe(true);
                expect(manager.hasStage('prod')).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should return false when removing non-existent stage', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const removed = await manager.removeStage('nonexistent');

                expect(removed).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should check if stage is locked', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', { ...testStage, locked: true });
                await manager.setStage('dev', { ...testStage, locked: false });

                expect(manager.isStageLockedByName('prod')).toBe(true);
                expect(manager.isStageLockedByName('dev')).toBe(false);
                expect(manager.isStageLockedByName('nonexistent')).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should get required secrets', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', {
                    secrets: [
                        { key: 'REQUIRED', type: 'password', required: true },
                        { key: 'OPTIONAL', type: 'string', required: false },
                        { key: 'DEFAULT_REQUIRED', type: 'api_key' },
                    ],
                });

                const secrets = manager.getRequiredSecrets('prod');

                expect(secrets.length).toBe(2);
                expect(secrets.map((s) => s.key)).toContain('REQUIRED');
                expect(secrets.map((s) => s.key)).toContain('DEFAULT_REQUIRED');
                expect(secrets.map((s) => s.key)).not.toContain('OPTIONAL');

            }
            finally {

                cleanup();

            }

        });

        it('should get stage defaults', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', testStage);

                const defaults = manager.getStageDefaults('prod');

                expect(defaults.dialect).toBe('postgres');
                expect(defaults.protected).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should return empty defaults for non-existent stage', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                const defaults = manager.getStageDefaults('nonexistent');

                expect(defaults).toEqual({});

            }
            finally {

                cleanup();

            }

        });

        it('should check if stage enforces protected', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', { defaults: { protected: true } });
                await manager.setStage('dev', { defaults: { protected: false } });

                expect(manager.stageEnforcesProtected('prod')).toBe(true);
                expect(manager.stageEnforcesProtected('dev')).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should check if stage enforces isTest', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('test', { defaults: { isTest: true } });
                await manager.setStage('prod', { defaults: { isTest: false } });

                expect(manager.stageEnforcesIsTest('test')).toBe(true);
                expect(manager.stageEnforcesIsTest('prod')).toBe(false);

            }
            finally {

                cleanup();

            }

        });

    });

    describe('rule operations', () => {

        const testRule: Rule = {
            match: { isTest: true },
            include: ['sql/seeds'],
        };

        it('should add a rule', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.addRule(testRule);

                const rules = manager.getRules();

                expect(rules.length).toBe(1);
                expect(rules[0]).toEqual(testRule);

            }
            finally {

                cleanup();

            }

        });

        it('should add multiple rules', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.addRule(testRule);
                await manager.addRule({
                    match: { protected: true },
                    exclude: ['sql/dangerous'],
                });

                const rules = manager.getRules();

                expect(rules.length).toBe(2);

            }
            finally {

                cleanup();

            }

        });

        it('should remove a rule by index', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.addRule(testRule);
                await manager.addRule({
                    match: { protected: true },
                    exclude: ['sql/dangerous'],
                });

                const removed = await manager.removeRule(0);

                expect(removed).toBe(true);

                const rules = manager.getRules();

                expect(rules.length).toBe(1);
                expect(rules[0].match.protected).toBe(true);

            }
            finally {

                cleanup();

            }

        });

        it('should return false when removing rule with invalid index', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.addRule(testRule);

                expect(await manager.removeRule(-1)).toBe(false);
                expect(await manager.removeRule(5)).toBe(false);

            }
            finally {

                cleanup();

            }

        });

    });

    describe('config mutations', () => {

        it('should update build config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setBuild({
                    include: ['custom/tables'],
                    exclude: ['custom/archive'],
                });

                const build = manager.getBuild();

                expect(build.include).toEqual(['custom/tables']);
                expect(build.exclude).toEqual(['custom/archive']);

            }
            finally {

                cleanup();

            }

        });

        it('should update paths config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setPaths({
                    sql: './db/sql',
                    changes: './db/migrations',
                });

                const paths = manager.getPaths();

                expect(paths.sql).toBe('./db/sql');
                expect(paths.changes).toBe('./db/migrations');

            }
            finally {

                cleanup();

            }

        });

        it('should update strict config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStrict({
                    enabled: true,
                    stages: ['dev', 'prod'],
                });

                const strict = manager.getStrict();

                expect(strict.enabled).toBe(true);
                expect(strict.stages).toEqual(['dev', 'prod']);

            }
            finally {

                cleanup();

            }

        });

        it('should update logging config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setLogging({
                    enabled: true,
                    level: 'verbose',
                    file: '.noorm/state/verbose.log',
                    maxSize: '50mb',
                    maxFiles: 10,
                });

                const logging = manager.getLogging();

                expect(logging.level).toBe('verbose');
                expect(logging.file).toBe('.noorm/state/verbose.log');

            }
            finally {

                cleanup();

            }

        });

    });

    describe('strict mode', () => {

        it('should report strict mode disabled by default', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();

                expect(manager.isStrictModeEnabled()).toBe(false);

            }
            finally {

                cleanup();

            }

        });

        it('should return required stages when strict mode enabled', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStrict({
                    enabled: true,
                    stages: ['dev', 'test', 'prod'],
                });

                expect(manager.isStrictModeEnabled()).toBe(true);
                expect(manager.getRequiredStages()).toEqual(['dev', 'test', 'prod']);

            }
            finally {

                cleanup();

            }

        });

        it('should return empty array when strict mode disabled', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStrict({
                    enabled: false,
                    stages: ['dev', 'test', 'prod'],
                });

                expect(manager.getRequiredStages()).toEqual([]);

            }
            finally {

                cleanup();

            }

        });

    });

    describe('rule evaluation', () => {

        it('should evaluate rules against config', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.addRule({ match: { isTest: true }, include: ['sql/seeds'] });
                await manager.addRule({
                    match: { protected: true },
                    exclude: ['sql/dangerous'],
                });

                const testConfig = {
                    name: 'test',
                    type: 'local' as const,
                    isTest: true,
                    protected: false,
                };

                const result = manager.evaluateRules(testConfig);

                expect(result.matchedRules.length).toBe(1);
                expect(result.include).toContain('sql/seeds');

            }
            finally {

                cleanup();

            }

        });

        it('should get effective build paths', async () => {

            const { manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setBuild({
                    include: ['sql/tables', 'sql/views'],
                    exclude: ['sql/archive'],
                });
                await manager.addRule({ match: { isTest: true }, include: ['sql/seeds'] });
                await manager.addRule({
                    match: { protected: true },
                    exclude: ['sql/dangerous'],
                });

                const testConfig = {
                    name: 'test',
                    type: 'local' as const,
                    isTest: true,
                    protected: false,
                };

                const result = manager.getEffectiveBuildPaths(testConfig);

                expect(result.include).toContain('sql/tables');
                expect(result.include).toContain('sql/views');
                expect(result.include).toContain('sql/seeds');
                expect(result.exclude).toContain('sql/archive');

            }
            finally {

                cleanup();

            }

        });

    });

    describe('persistence', () => {

        it('should persist and reload settings', async () => {

            const { tempDir, manager, cleanup } = createTestContext();

            try {

                await manager.load();
                await manager.setStage('prod', {
                    description: 'Production',
                    locked: true,
                    defaults: { dialect: 'postgres', protected: true },
                });
                await manager.addRule({ match: { isTest: true }, include: ['sql/seeds'] });

                // Create new manager and reload from same directory
                const manager2 = new SettingsManager(tempDir, {
                    settingsDir: '.test-settings',
                    settingsFile: 'settings.yml',
                });
                await manager2.load();

                expect(manager2.hasStage('prod')).toBe(true);
                expect(manager2.getStage('prod')?.description).toBe('Production');
                expect(manager2.getRules().length).toBe(1);

            }
            finally {

                cleanup();

            }

        });

    });

});

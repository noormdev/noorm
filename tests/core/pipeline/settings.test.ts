import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager, resetSettingsManager } from '../../../src/core/settings/manager.js';
import { loadPipelineDefinition } from '../../../src/core/pipeline/definition.js';

let root: string;
let environment: Record<string, string>;

beforeEach(async () => {

    root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-settings-'));
    environment = {};
    for (const [key, value] of Object.entries(process.env)) {

        if (key.startsWith('NOORM_') && value !== undefined) {

            environment[key] = value;
            delete process.env[key];

        }

    }
    resetSettingsManager();

});

afterEach(async () => {

    for (const key of Object.keys(process.env)) {

        if (key.startsWith('NOORM_')) delete process.env[key];

    }
    Object.assign(process.env, environment);
    resetSettingsManager();
    await rm(root, { recursive: true, force: true });

});

async function createPipeline(path: string, id: string) {

    const folder = join(root, path, 'refresh');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({ steps: [{ id, sql: 'step.sql' }] }));
    await writeFile(join(folder, 'step.sql'), 'select 1;');

}

async function selectedId(manager: SettingsManager) {

    const definition = await loadPipelineDefinition({
        projectRoot: root,
        pipelinesPath: manager.getPaths().pipelines!,
        slug: 'refresh',
    });

    return definition.steps[0]?.id;

}

describe('pipeline: path settings', () => {

    it('should select the default project-relative directory', async () => {

        await createPipeline('db/pipelines', 'defaultStep');
        const manager = new SettingsManager(root);
        await manager.load();
        expect(await selectedId(manager)).toBe('defaultStep');

    });

    it('should default the pipeline path when other paths are configured', async () => {

        await mkdir(join(root, '.noorm'));
        await writeFile(join(root, '.noorm', 'settings.yml'), 'paths:\n    sql: ./custom/sql\n');
        await createPipeline('db/pipelines', 'defaultStep');
        const manager = new SettingsManager(root);
        await manager.load();
        expect(await selectedId(manager)).toBe('defaultStep');

    });

    it('should use the configured path and persist explicit changes', async () => {

        await mkdir(join(root, '.noorm'));
        await writeFile(join(root, '.noorm', 'settings.yml'), 'paths:\n    pipelines: ./custom/workflows\n');
        await createPipeline('custom/workflows', 'configured');
        await createPipeline('other/workflows', 'changed');
        const manager = new SettingsManager(root);
        await manager.load();
        expect(await selectedId(manager)).toBe('configured');
        await manager.setPaths({ ...manager.getPaths(), pipelines: './other/workflows' });
        const reloaded = new SettingsManager(root);
        await reloaded.load();
        expect(await selectedId(reloaded)).toBe('changed');

    });

    it('should keep the pipelines path when only sql and changes are saved', async () => {

        await mkdir(join(root, '.noorm'));
        await writeFile(join(root, '.noorm', 'settings.yml'), 'paths:\n    pipelines: ./custom/workflows\n');
        const manager = new SettingsManager(root);
        await manager.load();
        await manager.setPaths({ sql: './db/sql', changes: './db/changes' });
        const reloaded = new SettingsManager(root);
        await reloaded.load();
        expect(reloaded.getPaths().pipelines).toBe('./custom/workflows');

    });

    it('should use the environment overlay at runtime without persisting it', async () => {

        await mkdir(join(root, '.noorm'));
        const settingsFile = join(root, '.noorm', 'settings.yml');
        await writeFile(settingsFile, 'paths:\n    pipelines: ./committed\n');
        await createPipeline('committed', 'committed');
        await createPipeline('overlay', 'overlay');
        process.env['NOORM_PATHS_PIPELINES'] = './overlay';
        const manager = new SettingsManager(root);
        await manager.load();
        expect(await selectedId(manager)).toBe('overlay');
        await manager.save();
        const saved = await readFile(settingsFile, 'utf8');
        expect(saved).toContain('./committed');
        expect(saved).not.toContain('./overlay');
        delete process.env['NOORM_PATHS_PIPELINES'];
        const reloaded = new SettingsManager(root);
        await reloaded.load();
        expect(await selectedId(reloaded)).toBe('committed');

    });

});

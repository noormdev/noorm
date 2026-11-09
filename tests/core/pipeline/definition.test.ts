import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPipelineDefinition } from '../../../src/core/pipeline/definition.js';

let root: string;
let folder: string;

beforeEach(async () => {

    root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-definition-'));
    folder = join(root, 'db', 'pipelines', 'refresh');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'one.sql'), 'select 1;');
    await writeFile(join(folder, 'two.sql.tmpl'), 'select 2;');

});

afterEach(async () => {

    await rm(root, { recursive: true, force: true });

});

async function load(manifest: unknown, slug = 'refresh') {

    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify(manifest));

    return loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug });

}

const one = { id: 'one', sql: 'one.sql' };
const two = { id: 'two', sql: 'two.sql.tmpl' };

describe('pipeline: definitions', () => {

    it('should normalize linear declarations and preserve repeated file identities', async () => {

        const definition = await load({ steps: [one, two, { id: 'again', sql: 'one.sql' }] });
        expect(definition.steps.map(({ stepNo, id, sql, needs }) => ({ stepNo, id, sql, needs }))).toEqual([
            { stepNo: 1, id: 'one', sql: 'one.sql', needs: [] },
            { stepNo: 2, id: 'two', sql: 'two.sql.tmpl', needs: [1] },
            { stepNo: 3, id: 'again', sql: 'one.sql', needs: [2] },
        ]);

    });

    it('should map graph labels to declaration numbers even for forward references', async () => {

        const definition = await load({ steps: [
            { ...one, needs: ['two', 'root'] },
            { ...two, needs: ['root'] },
            { id: 'root', sql: 'one.sql', needs: [] },
        ] });
        expect(definition.steps.map(({ stepNo, id, needs }) => ({ stepNo, id, needs }))).toEqual([
            { stepNo: 1, id: 'one', needs: [2, 3] },
            { stepNo: 2, id: 'two', needs: [3] },
            { stepNo: 3, id: 'root', needs: [] },
        ]);

    });

    it('should enforce portable label and declared SQL path bounds without normalizing labels', async () => {

        const id = '😀'.repeat(127) + 'x';
        const definition = await load({ steps: [{ id, sql: 'one.sql' }, { id: 'one ', sql: 'two.sql.tmpl' }] });
        expect(definition.steps.map((step) => step.id)).toEqual([id, 'one ']);
        await expect(load({ steps: [{ id: '😀'.repeat(128), sql: 'one.sql' }] })).rejects.toThrow();
        await expect(load({ steps: [{ id: '', sql: 'one.sql' }] })).rejects.toThrow();

        const directory = 'a'.repeat(245);
        const filename = 'b'.repeat(250) + '.sql';
        const path500 = `${directory}/${filename}`;
        await mkdir(join(folder, directory));
        await writeFile(join(folder, path500), 'select 1;');
        const accepted = await load({ steps: [{ id: 'path', sql: path500 }] });
        expect(accepted.steps[0]?.sql).toBe(path500);
        await expect(load({ steps: [{ id: 'path', sql: `${directory}/${'b'.repeat(251)}.sql` }] })).rejects.toThrow();
        await expect(load({ steps: [{ id: 'path', sql: '' }] })).rejects.toThrow();

    });

    it('should return manifest provenance and execution defaults', async () => {

        const definition = await load({ steps: [one] });
        expect(definition.slug).toBe('refresh');
        expect(definition.folder).toBe(await realpath(folder));
        expect(definition.manifestPath).toBe(await realpath(join(folder, 'pipeline.yml')));
        expect(definition.manifestChecksum).toMatch(/^[a-f0-9]{64}$/);
        expect(definition.mode).toBe('linear');
        expect(definition.transaction).toBe('step');
        expect(definition.concurrency).toBe(4);
        expect(definition.singleRun).toBe(false);
        expect(definition.steps[0]?.filepath).toBe(await realpath(join(folder, 'one.sql')));

    });

    it('should retain explicit execution policy for graph mode', async () => {

        const definition = await load({ transaction: 'none', concurrency: 2, singleRun: true, steps: [{ ...one, needs: [] }] });
        expect([definition.mode, definition.transaction, definition.concurrency, definition.singleRun]).toEqual(['graph', 'none', 2, true]);

    });

    const invalidGraphs = [
        ['mixed ordering', [{ ...one, needs: [] }, two]],
        ['duplicate IDs', [one, { ...two, id: 'one' }]],
        ['duplicate prerequisites', [{ ...one, needs: [] }, { ...two, needs: ['one', 'one'] }]],
        ['unknown prerequisite', [{ ...one, needs: ['missing'] }]],
        ['self dependency', [{ ...one, needs: ['one'] }]],
        ['cycle', [{ ...one, needs: ['two'] }, { ...two, needs: ['one'] }]],
        ['non-array prerequisites', [{ ...one, needs: 'two' }]],
    ] as const;
    for (const [name, steps] of invalidGraphs) {

        it(`should reject ${name}`, async () => {

            await expect(load({ steps })).rejects.toThrow();

        });

    }

    for (const slug of ['', '.', '..', '../refresh', '/refresh', 'a/b', 'a\\b']) {

        it(`should reject unsafe slug ${JSON.stringify(slug)}`, async () => {

            await expect(load({ steps: [one] }, slug)).rejects.toThrow();

        });

    }

    for (const slug of ['history', 'show', 'run']) {

        it(`should load the ordinary safe slug ${slug}`, async () => {

            const named = join(root, 'db', 'pipelines', slug);
            await mkdir(named);
            await writeFile(join(named, 'pipeline.yml'), JSON.stringify({ steps: [one] }));
            await writeFile(join(named, 'one.sql'), 'select 1;');
            expect((await loadPipelineDefinition({
                projectRoot: root, pipelinesPath: './db/pipelines', slug,
            })).slug).toBe(slug);

        });

    }

    it('should load a safe slug from the exact configured folder', async () => {

        const definition = await load({ steps: [one] });
        expect(definition.steps[0]?.id).toBe('one');

    });

    it('should reject a manifest symlink that escapes the selected folder', async () => {

        await writeFile(join(root, 'outside.yml'), JSON.stringify({ steps: [one] }));
        await symlink(join(root, 'outside.yml'), join(folder, 'pipeline.yml'));
        await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' })).rejects.toThrow();

    });

    for (const sql of ['missing.sql', 'one.txt', '../outside.sql', '/tmp/outside.sql']) {

        it(`should reject missing, unsupported or escaping step ${sql}`, async () => {

            await expect(load({ steps: [{ id: 'bad', sql }] })).rejects.toThrow();

        });

    }

    it('should reject a step symlink that escapes the selected folder', async () => {

        await writeFile(join(root, 'outside.sql'), 'select 1;');
        await symlink(join(root, 'outside.sql'), join(folder, 'escape.sql'));
        await expect(load({ steps: [{ id: 'bad', sql: 'escape.sql' }] })).rejects.toThrow();

    });

    it('should reject a selected folder symlink that escapes the pipelines root', async () => {

        const outside = join(root, 'outside');
        await mkdir(outside);
        await writeFile(join(outside, 'pipeline.yml'), JSON.stringify({ steps: [one] }));
        await writeFile(join(outside, 'one.sql'), 'select 1;');
        await symlink(outside, join(root, 'db', 'pipelines', 'linked'));
        await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'linked' })).rejects.toThrow();

    });

    it('should reject a pipelines root symlink outside the project', async () => {

        const outside = await mkdtemp(join(tmpdir(), 'noorm-outside-'));
        try {

            await symlink(outside, join(root, 'outside'));
            await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: 'outside', slug: 'refresh' })).rejects.toThrow();

        }
        finally {

            await rm(outside, { recursive: true, force: true });

        }

    });

    it('should reject absolute and traversing configured paths', async () => {

        for (const pipelinesPath of ['/tmp', '../elsewhere', 'db/../pipelines']) {

            await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath, slug: 'refresh' })).rejects.toThrow();

        }

    });

    it('should reject malformed YAML and a missing manifest', async () => {

        await writeFile(join(folder, 'pipeline.yml'), 'steps: [broken');
        await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' })).rejects.toThrow();
        await rm(join(folder, 'pipeline.yml'));
        await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' })).rejects.toThrow();

    });

    const invalidManifests: unknown[] = [
        null, [], {}, { steps: [] }, { steps: [one], extra: true },
        { steps: [{ ...one, extra: true }] }, { steps: [{ id: '', sql: 'one.sql' }] },
        { steps: [{ id: '   ', sql: 'one.sql' }] },
        { steps: [{ id: 'bad\u0000', sql: 'one.sql' }] },
        { steps: [{ id: '\uD800', sql: 'one.sql' }] },
        { steps: [{ id: '\uDFFF', sql: 'one.sql' }] },
        { steps: [{ id: 'one', sql: 'bad\u0000.sql' }] },
        { steps: [{ id: 'one', sql: 'bad\uD800.sql' }] },
        { steps: [{ id: 'x' }] }, { steps: [{ sql: 'one.sql' }] },
        { steps: [one], transaction: 'other' }, { steps: [one], concurrency: 0 },
        { steps: [one], concurrency: 1.5 }, { steps: [one], singleRun: 'true' },
        { steps: [one], inputs: [] },
    ];
    for (const manifest of invalidManifests) {

        it(`should reject invalid manifest ${JSON.stringify(manifest)}`, async () => {

            await expect(load(manifest)).rejects.toThrow();

        });

    }

    it('should accept valid defaults at scalar and JSON boundaries', async () => {

        const definition = await load({ inputs: {
            period: { type: 'string', description: 'Period', required: true, default: '', choices: ['', 'a'] },
            count: { type: 'integer', description: 'Count', default: Number.MAX_SAFE_INTEGER },
            ratio: { type: 'number', description: 'Ratio', default: 1.5 },
            enabled: { type: 'boolean', description: 'Enabled', default: false },
            filters: { type: 'object', description: 'Filters', default: { region: ['west', null] } },
            tags: { type: 'array', description: 'Tags', default: ['a'] },
        }, steps: [one] });
        expect(definition.steps).toHaveLength(1);

    });

    it('should reject a default outside its choices', async () => {

        await expect(load({ inputs: { value: {
            type: 'string', description: 'Value', default: 'c', choices: ['a', 'b'],
        } }, steps: [one] })).rejects.toThrow();

    });

    it('should reject non-JSON nested defaults in YAML', async () => {

        await writeFile(join(folder, 'pipeline.yml'), 'inputs:\n  data:\n    type: object\n    description: Data\n    default: { nested: .inf }\nsteps:\n  - { id: one, sql: one.sql }\n');
        await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' })).rejects.toThrow();

    });

    it('should reject prototype-polluting keys inside JSON defaults', async () => {

        await writeFile(join(folder, 'pipeline.yml'), 'inputs:\n  data:\n    type: object\n    description: Data\n    default: { nested: { constructor: 1 } }\nsteps:\n  - { id: one, sql: one.sql }\n');
        await expect(loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' })).rejects.toThrow();

    });

    const invalidInputs: Record<string, unknown>[] = [
        { Bad: { type: 'string', description: 'x' } },
        { bad_name: { type: 'string', description: 'x' } },
        { fooBar: { type: 'string', description: 'x' }, fooBAR: { type: 'string', description: 'x' } },
        { '1bad': { type: 'string', description: 'x' } },
        { value: { type: 'date', description: 'x' } },
        { value: { type: 'string', description: '' } },
        { value: { type: 'string' } },
        { value: { type: 'string', description: 'x', required: 'yes' } },
        { value: { type: 'string', description: 'x', unknown: true } },
        { value: { type: 'integer', description: 'x', default: 1.5 } },
        { value: { type: 'integer', description: 'x', default: 9007199254740992 } },
        { value: { type: 'boolean', description: 'x', default: 'false' } },
        { value: { type: 'string', description: 'x', choices: ['a', 1] } },
        { value: { type: 'object', description: 'x', choices: [{}] } },
        { value: { type: 'array', description: 'x', default: {} } },
        { slug: { type: 'string', description: 'x' } },
        { input: { type: 'string', description: 'x' } },
        { config: { type: 'string', description: 'x' } },
        { cwd: { type: 'string', description: 'x' } },
        { json: { type: 'string', description: 'x' } },
        { yes: { type: 'string', description: 'x' } },
        { force: { type: 'string', description: 'x' } },
        { dryRun: { type: 'string', description: 'x' } },
        { help: { type: 'string', description: 'x' } },
    ];
    for (const inputs of invalidInputs) {

        it(`should reject invalid input declaration ${JSON.stringify(inputs)}`, async () => {

            await expect(load({ inputs, steps: [one] })).rejects.toThrow();

        });

    }

});

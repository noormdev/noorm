import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';
import { checkConfigPolicy } from '../../../src/core/policy/index.js';
import { loadPipelineDefinition } from '../../../src/core/pipeline/definition.js';
import { preparePipeline } from '../../../src/core/pipeline/prepare.js';
import { PipelineEscapeError } from '../../../src/core/pipeline/sql-literal.js';
import type { RunContext } from '../../../src/core/runner/types.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import { processFile } from '../../../src/core/template/engine.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { createTestConnection } from '../../utils/db.js';
import { withPolicy } from '../../utils/access.js';

let root: string;
let folder: string;
let ctx: RunContext;
let destroy: () => Promise<void>;

beforeEach(async () => {

    root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-prepare-'));
    folder = join(root, 'db', 'pipelines', 'refresh');
    await mkdir(folder, { recursive: true });
    const connection = await createTestConnection('sqlite');
    destroy = connection.destroy;
    ctx = {
        db: connection.db as Kysely<NoormDatabase>, configName: 'test',
        identity: { name: 'Test', source: 'config' }, projectRoot: root,
        access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user', dialect: 'sqlite',
    };

});

afterEach(async () => {

    await destroy();
    await rm(root, { recursive: true, force: true });

});

async function definition(steps = [{ id: 'first', sql: 'one.sql.tmpl' }, { id: 'second', sql: 'two.sql.tmpl' }]) {

    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
        inputs: { name: { type: 'string', description: 'Name', required: true }, optional: { type: 'string', description: 'Optional' } }, steps,
    }));

    return loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' });

}

async function tables() {

    return (await sql<{ name: string }>`select name from sqlite_master where type = 'table'`.execute(ctx.db)).rows.map((row) => row.name);

}

describe('pipeline: preparation', () => {

    it('should reserve one invocation input over adjacent data in every step and include, without changing normal rendering', async () => {

        await writeFile(join(folder, 'input.json'), JSON.stringify({ name: 'local data' }));
        await writeFile(join(folder, 'part.sql.tmpl'), 'include={%~ $.quote($.input.name) %}');
        await writeFile(join(folder, 'one.sql.tmpl'), "select {%~ $.quote($.input.name) %}; {%~ await $.include('part.sql.tmpl') %}");
        await writeFile(join(folder, 'two.sql.tmpl'), "select {%~ $.quote($.input.name) %}; {%~ 'optional' in $.input ? 'present' : 'absent' %}");
        const plan = await definition();
        const before = await tables();
        const prepared = await preparePipeline(ctx, plan, { input: { name: "O'Brien" } });
        expect(prepared.steps).toHaveLength(2);
        expect(prepared.steps[0]?.sql).toContain("'O''Brien'");
        expect(prepared.steps[0]?.sql).toContain("include='O''Brien'");
        expect(prepared.steps[1]?.sql).toContain("'O''Brien'");
        expect(prepared.steps[1]?.sql).toContain('absent');
        const normalFile = await realpath(join(folder, 'one.sql.tmpl'));
        expect((await processFile(normalFile, { projectRoot: await realpath(root) })).sql).toContain('local data');
        expect(await tables()).toEqual(before);

    });
    it('should use target literals in steps and includes without changing generic quotes or primitive semantics', async () => {

        await writeFile(join(folder, 'part.sql.tmpl'), '{%~ $.quote($.input.name) %}');
        await writeFile(join(folder, 'one.sql.tmpl'), "select {%~ $.quote($.input.name) %}, {%~ await $.include('part.sql.tmpl') %}, {%~ $.quote(null) %}, {%~ $.quote(42) %}, {%~ $.quote(false) %}");
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        const plan = await definition();
        const value = "Café O'Brien\\back";
        for (const [dialect, literal] of [
            ['sqlite', "'Café O''Brien\\back'"],
            ['postgres', "U&'\\0043\\0061\\0066\\00E9\\0020\\004F\\0027\\0042\\0072\\0069\\0065\\006E\\005C\\0062\\0061\\0063\\006B'"],
            ['mysql', `_utf8mb4 X'${Buffer.from(value).toString('hex')}'`],
            ['mssql', "N'Café O''Brien\\back'"],
        ] as const) {

            const prepared = await preparePipeline({ ...ctx, dialect }, plan, { input: { name: value } });
            expect(prepared.steps[0]?.sql).toBe(`select ${literal}, ${literal}, NULL, '42', 'false'`);

        }
        const normal = await processFile(join(folder, 'one.sql.tmpl'), { projectRoot: root, pipelineInput: { name: value } });
        expect(normal.sql).toBe("select 'Café O''Brien\\back', 'Café O''Brien\\back', NULL, '42', 'false'");

    });

    it('should escape code points above U+FFFF in PostgreSQL U& literals with the six-digit form', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), 'select {%~ $.quote($.input.name) %}');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        const prepared = await preparePipeline({ ...ctx, dialect: 'postgres' }, await definition(), { input: { name: '😀' } });
        expect(prepared.steps[0]?.sql).toBe("select U&'\\+01F600'");

    });

    it('should reject $.escape in every pipeline render without echoing the input', async () => {

        const secret = "x\\' OR 1=1 -- ";
        await writeFile(join(folder, 'part.sql.tmpl'), "'{%~ $.escape($.input.name) %}'");
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        const bodies = {
            step: "select '{%~ $.escape($.input.name) %}'",
            include: "select {%~ await $.include('part.sql.tmpl') %}",
        };
        const dialects: Dialect[] = ['sqlite', 'postgres', 'mysql', 'mssql'];
        for (const dialect of dialects) {

            for (const body of Object.values(bodies)) {

                await writeFile(join(folder, 'one.sql.tmpl'), body);
                const failure = preparePipeline({ ...ctx, dialect }, await definition(), { input: { name: secret } });
                await expect(failure).rejects.toThrow(`Failed to prepare pipeline step 1: ${new PipelineEscapeError().message}`);
                await expect(failure).rejects.not.toThrow('OR 1=1');

            }

        }

    });

    it('should keep $.escape doubling quotes outside pipeline renders', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), "select '{%~ $.escape($.input.name) %}'");
        const normal = await processFile(join(folder, 'one.sql.tmpl'), { projectRoot: root, pipelineInput: { name: "O'Brien" } });
        expect(normal.sql).toBe("select 'O''Brien'");

    });


    it('should render includes with an explicitly symlinked project root and still block traversal', async () => {

        const alias = join(root, 'project-link');
        await symlink(root, alias, 'dir');
        await writeFile(join(folder, 'part.sql.tmpl'), 'include={%~ $.quote($.input.name) %}');
        await writeFile(join(folder, 'one.sql.tmpl'), "{%~ await $.include('part.sql.tmpl') %}");
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        const plan = await definition();
        const aliasedContext = { ...ctx, projectRoot: alias };
        const prepared = await preparePipeline(aliasedContext, plan, { input: { name: "O'Brien" } });
        expect(prepared.steps[0]?.sql).toContain("include='O''Brien'");

        const outside = `${root}-outside.sql`;
        await writeFile(outside, 'select 2');
        try {

            const escape = `../../../../${basename(outside)}`;
            await writeFile(join(folder, 'one.sql.tmpl'), `{%~ await $.include('${escape}') %}`);
            await expect(preparePipeline(aliasedContext, plan, { input: { name: 'x' } })).rejects.toThrow(
                'Failed to prepare pipeline step 1',
            );

        }
        finally {

            await rm(outside, { force: true });

        }

    });

    it('should fail on missing input property rather than rendering undefined', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), 'select {%~ $.input.optional %}');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        await expect(preparePipeline(ctx, await definition(), { input: { name: 'x' } })).rejects.toThrow();
        expect(await tables()).toEqual([]);

    });

    it('should reject missing members at every structured depth, including in includes', async () => {

        await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
            inputs: { data: { type: 'object', description: 'Data', required: true } },
            steps: [{ id: 'first', sql: 'one.sql.tmpl' }],
        }));
        await writeFile(join(folder, 'one.sql.tmpl'), "{%~ await $.include('part.sql.tmpl') %}");
        const plan = await loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' });
        const input = { data: { nested: { items: [{ name: 'one' }] } } };
        for (const expression of [
            '$.input.data.nested.missing || "fallback"',
            '$.input.data.nested.items[1] || "fallback"',
            '$.input.data.nested.items[0].missing || "fallback"',
        ]) {

            await writeFile(join(folder, 'part.sql.tmpl'), `{%~ ${expression} %}`);
            await expect(preparePipeline(ctx, plan, { input })).rejects.toThrow('Failed to prepare pipeline step 1');

        }

    });

    it('should preserve frozen structured input, JSON, membership and array protocols in steps and includes', async () => {

        await writeFile(join(folder, 'pipeline.yml'), JSON.stringify({
            inputs: { data: { type: 'object', description: 'Data', required: true } },
            steps: [{ id: 'first', sql: 'one.sql.tmpl' }, { id: 'second', sql: 'two.sql.tmpl' }],
        }));
        const input = { data: { nested: { items: [{ name: 'one' }, { name: 'two' }] } } };
        const expression = [
            'Object.isFrozen($.input.data)',
            'Object.isFrozen($.input.data.nested.items)',
            'Object.isFrozen($.input.data.nested.items[0])',
            '"missing" in $.input.data.nested',
            '2 in $.input.data.nested.items',
            'JSON.stringify($.input.data)',
            '$.input.data.nested.items.map(x => x.name).join(",")',
            '[...$.input.data.nested.items].length',
        ].join(', ');
        await writeFile(join(folder, 'part.sql.tmpl'), `{%~ JSON.stringify([${expression}]) %}`);
        await writeFile(join(folder, 'one.sql.tmpl'), "{%~ await $.include('part.sql.tmpl') %}");
        await writeFile(join(folder, 'two.sql.tmpl'), `{%~ JSON.stringify([${expression}]) %}`);
        const plan = await loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' });
        const prepared = await preparePipeline(ctx, plan, { input });
        const expected = [true, true, true, false, false, JSON.stringify(input.data), 'one,two', 2];
        expect(JSON.parse(prepared.steps[0]!.sql)).toEqual(expected);
        expect(JSON.parse(prepared.steps[1]!.sql)).toEqual(expected);
        expect(Object.isFrozen(input.data)).toBe(false);
        expect(input.data.nested.items).toEqual([{ name: 'one' }, { name: 'two' }]);

    });

    it('should render all declarations once and retain SQL and checksums despite file and caller mutation', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), 'select {%~ $.quote($.input.name) %}, {%~ $.quote($.uuid()) %}');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select {%~ $.quote($.input.name) %}, {%~ $.quote($.uuid()) %}');
        const plan = await definition([{ id: 'first', sql: 'one.sql.tmpl' }, { id: 'again', sql: 'one.sql.tmpl' }, { id: 'last', sql: 'two.sql.tmpl' }]);
        const input = { name: 'original' };
        const prepared = await preparePipeline(ctx, plan, { input });
        const snapshot = prepared.steps.map((step) => ({ sql: step.sql, checksum: step.checksum }));
        expect(snapshot).toHaveLength(3);
        expect(prepared.steps.map((step) => [step.stepNo, step.id, step.sqlPath, step.needs])).toEqual([
            [1, 'first', 'one.sql.tmpl', []],
            [2, 'again', 'one.sql.tmpl', [1]],
            [3, 'last', 'two.sql.tmpl', [2]],
        ]);
        expect(new Set(snapshot.map((step) => step.sql)).size).toBe(3);
        for (const step of snapshot) {

            expect(step.sql).toContain("'original'");
            expect(step.checksum).toBe(createHash('sha256').update(step.sql).digest('hex'));

        }
        input.name = 'changed';
        await writeFile(join(folder, 'one.sql.tmpl'), 'select 999');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 999');
        expect(prepared.steps.map((step) => ({ sql: step.sql, checksum: step.checksum }))).toEqual(snapshot);
        expect(await tables()).toEqual([]);

    });

    it('should sanitize a template exception containing supplied input', async () => {

        const secret = 'sensitive-input-never-in-error-729';
        await writeFile(join(folder, 'one.sql.tmpl'), '{% throw new Error($.input.name) %}');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        try {

            await preparePipeline(ctx, await definition(), { input: { name: secret } });
            throw new Error('expected template failure');

        }
        catch (error) {

            expect(error).toBeInstanceOf(Error);
            expect(String(error)).not.toContain(secret);
            expect(JSON.stringify(error)).not.toContain(secret);
            expect(String(error)).not.toContain('expected template failure');

        }
        expect(await tables()).toEqual([]);

    });

    it('should enforce viewer, operator confirmation, and agent restrictions before rendering', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), '{% throw new Error("render-was-reached") %}');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 1');
        const plan = await definition();
        for (const [access, channel, yes] of [
            [withPolicy({ user: 'viewer', agent: 'viewer' }), 'user', false],
            [withPolicy({ user: 'operator', agent: 'operator' }), 'user', false],
            [withPolicy({ user: 'operator', agent: 'operator' }), 'agent', true],
        ] as const) {

            try {

                await preparePipeline({ ...ctx, access, channel }, plan, { input: { name: 'x' }, yes });
                throw new Error('expected policy denial');

            }
            catch (error) {

                expect(String(error)).not.toContain('render-was-reached');
                expect(String(error)).not.toContain('expected policy denial');

            }

        }
        await writeFile(join(folder, 'one.sql.tmpl'), 'select {%~ $.quote($.input.name) %}');
        const allowed = await preparePipeline({ ...ctx, access: withPolicy({ user: 'operator', agent: 'operator' }) }, plan, { input: { name: 'x' }, yes: true });
        expect(allowed.steps[0]?.sql).toContain("'x'");
        expect(await tables()).toEqual([]);

    });

    it('should authorize pipelines with pipeline:run, independent of run:dir', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), 'select 1');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 2');
        const plan = await definition();
        const roles = {
            pipeliner: { permissions: { 'pipeline:run': 'allow' as const, 'run:dir': 'deny' as const } },
            dirOnly: { permissions: { 'pipeline:run': 'deny' as const, 'run:dir': 'allow' as const } },
        };
        const allowed = await preparePipeline({ ...ctx, access: withPolicy({ user: 'pipeliner', agent: 'pipeliner' }, { roles }) }, plan, { input: { name: 'x' } });
        expect(allowed.steps).toHaveLength(2);

        const [, denied] = await attempt(() => preparePipeline({ ...ctx, access: withPolicy({ user: 'dirOnly', agent: 'dirOnly' }, { roles }) }, plan, { input: { name: 'x' } }));
        expect(denied?.message).toContain('pipeline:run');

        const runDir = checkConfigPolicy('user', { name: 'test', access: withPolicy({ user: 'pipeliner', agent: 'pipeliner' }, { roles }) }, 'run:dir');
        expect(runDir.allowed).toBe(false);

    });

    it('should refuse an agent on a pipeline:run confirm cell even with yes', async () => {

        await writeFile(join(folder, 'one.sql.tmpl'), 'select 1');
        await writeFile(join(folder, 'two.sql.tmpl'), 'select 2');
        const plan = await definition();
        const access = withPolicy({ user: 'operator', agent: 'operator' });

        const [, err] = await attempt(() => preparePipeline({ ...ctx, access, channel: 'agent' }, plan, { input: { name: 'x' }, yes: true }));

        expect(err?.message).toContain('pipeline:run');
        expect(err?.message).toContain('requires confirmation from a human');

    });

});

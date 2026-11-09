import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { attempt } from '@logosdx/utils';

import { PipelineBusyError } from '../../../src/core/pipeline/admission.js';
import { loadPipelineDefinition } from '../../../src/core/pipeline/definition.js';
import { classOnlyCause, PipelineCodedError } from '../../../src/core/pipeline/errors.js';
import { resolvePipelineInput } from '../../../src/core/pipeline/input.js';
import { preparePipeline } from '../../../src/core/pipeline/prepare.js';
import { assertManagedPipelineSql } from '../../../src/core/pipeline/sql-guard.js';
import type { RunContext } from '../../../src/core/runner/types.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import { createTestConnection } from '../../utils/db.js';
import { withPolicy } from '../../utils/access.js';

const secret = 'private-value-9327';
let root: string;
let folder: string;

beforeEach(async () => {

    root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-errors-'));
    folder = join(root, 'db', 'pipelines', 'refresh');
    await mkdir(folder, { recursive: true });

});

afterEach(async () => {

    await rm(root, { recursive: true, force: true });

});

async function load(manifest: unknown) {

    await writeFile(join(folder, 'pipeline.yml'), JSON.stringify(manifest));

    return loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' });

}

async function failure(run: () => Promise<unknown>) {

    const [, error] = await attempt(run);
    if (!(error instanceof PipelineCodedError)) throw error ?? new Error('Expected the call to fail');

    return error;

}

async function pipelineWithStep(sqlFile: string, content: string) {

    await writeFile(join(folder, sqlFile), content);

    return load({ steps: [{ id: 'one', sql: sqlFile }] });

}

describe('pipeline: error classification', () => {

    it('should keep PIPELINE_BUSY on the busy error', () => {

        expect(new PipelineBusyError()).toMatchObject({ code: 'PIPELINE_BUSY', message: 'Pipeline is already running' });

    });

    it('should name a missing step file without echoing the project path', async () => {

        const error = await failure(() => load({ steps: [{ id: 'one', sql: 'absent.sql' }] }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'missing-file' });
        expect(error.message).not.toContain(root);

    });

    it('should report an unknown slug as PIPELINE_NOT_FOUND', async () => {

        const error = await failure(() => loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'typo' }));
        expect(error).toMatchObject({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found' });

    });

    it('should name a missing pipelines directory', async () => {

        const error = await failure(() => loadPipelineDefinition({ projectRoot: root, pipelinesPath: './absent', slug: 'refresh' }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'missing-directory' });

    });

    it('should name an unreadable path and keep only the failure class as its cause', async () => {

        await symlink(join(root, 'db', 'pipelines', 'loop'), join(root, 'db', 'pipelines', 'loop'));
        const error = await failure(() => loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'loop' }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'unreadable-path' });
        expect(error.cause).toBeInstanceOf(Error);
        expect(inspect(error)).not.toContain(root);

    });

    it.skipIf(process.getuid?.() === 0)('should name an unreadable manifest without echoing the project path', async () => {

        const manifest = join(folder, 'pipeline.yml');
        await writeFile(manifest, 'steps: []');
        await chmod(manifest, 0o000);

        try {

            const error = await failure(() => loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' }));
            expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'unreadable-path' });
            expect(inspect(error)).not.toContain(root);

        }
        finally {

            await chmod(manifest, 0o644);

        }

    });

    it('should name a dependency cycle', async () => {

        await writeFile(join(folder, 'one.sql'), 'select 1');
        const error = await failure(() => load({ steps: [
            { id: 'a', sql: 'one.sql', needs: ['b'] }, { id: 'b', sql: 'one.sql', needs: ['a'] },
        ] }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'dependency-cycle' });

    });

    it('should name an unknown manifest key without echoing its value', async () => {

        await writeFile(join(folder, 'one.sql'), 'select 1');
        const error = await failure(() => load({ [secret]: secret, steps: [{ id: 'a', sql: 'one.sql' }] }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'manifest-schema' });
        expect(error.message).not.toContain(secret);

    });

    it('should not echo a rejected default value', async () => {

        await writeFile(join(folder, 'one.sql'), 'select 1');
        const error = await failure(() => load({
            inputs: { mode: { type: 'string', description: 'Mode', default: secret, choices: ['a'] } },
            steps: [{ id: 'a', sql: 'one.sql' }],
        }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'input-default-choice' });
        expect(error.message).not.toContain(secret);

    });

    it('should keep only the class name of a YAML parse failure as its cause', async () => {

        await writeFile(join(folder, 'pipeline.yml'), `inputs: [${secret}\n`);
        const error = await failure(() => loadPipelineDefinition({ projectRoot: root, pipelinesPath: './db/pipelines', slug: 'refresh' }));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'yaml' });
        expect(error.cause).toMatchObject({ name: 'YAMLParseError', message: 'Cause text withheld' });
        expect(inspect(error)).not.toContain(secret);

    });

    it('should classify managed transaction control as an invalid definition', async () => {

        const error = await failure(async () => assertManagedPipelineSql('COMMIT', 'sqlite', 'step'));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'transaction-control' });

    });

    it('should classify undeclared, mistyped and missing input as invalid input', async () => {

        const declarations = { name: { type: 'string' as const, description: 'Name', required: true } };
        for (const input of [{}, { name: 1 }, { name: 'x', extra: secret }]) {

            const error = await failure(async () => resolvePipelineInput(declarations, input));
            expect(error.code).toBe('PIPELINE_INVALID_INPUT');
            expect(error.message).not.toContain(secret);

        }

    });

});

describe('pipeline: classOnlyCause', () => {

    it('should keep an error class name', () => {

        expect(classOnlyCause(new RangeError('x')).name).toBe('RangeError');

    });

    it('should replace a name that is not an error class with Error', () => {

        const named = new Error('x');
        named.name = `leaked ${secret}`;
        expect(classOnlyCause(named)).toMatchObject({ name: 'Error', message: 'Cause text withheld' });
        expect(classOnlyCause(null).name).toBe('Error');

    });

});

describe('pipeline: prepare failures', () => {

    let ctx: RunContext;
    let destroy: () => Promise<void>;

    beforeEach(async () => {

        const connection = await createTestConnection('sqlite');
        destroy = connection.destroy;
        ctx = {
            db: connection.db.withTables<Pick<NoormDatabase, keyof NoormDatabase>>(), configName: 'test',
            identity: { name: 'Test', source: 'config' }, projectRoot: root,
            access: withPolicy({ user: 'admin', agent: 'admin' }), channel: 'user', dialect: 'sqlite',
        };

    });

    afterEach(async () => {

        await destroy();

    });

    it('should block a viewer with PIPELINE_POLICY_BLOCKED', async () => {

        const plan = await pipelineWithStep('one.sql', 'select 1');
        const error = await failure(() => preparePipeline({ ...ctx, access: withPolicy({ user: 'viewer', agent: 'viewer' }) }, plan));
        expect(error.code).toBe('PIPELINE_POLICY_BLOCKED');

    });

    it('should require confirmation from an operator with PIPELINE_CONFIRMATION_REQUIRED', async () => {

        const plan = await pipelineWithStep('one.sql', 'select 1');
        const error = await failure(() => preparePipeline({ ...ctx, access: withPolicy({ user: 'operator', agent: 'operator' }) }, plan));
        expect(error.code).toBe('PIPELINE_CONFIRMATION_REQUIRED');

    });

    it('should name $.escape as unavailable and keep its fixed-text cause', async () => {

        const plan = await pipelineWithStep('one.sql.tmpl', `select {%~ $.escape('${secret}') %}`);
        const error = await failure(() => preparePipeline(ctx, plan));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'escape-unavailable' });
        expect(error.message).toStartWith('Failed to prepare pipeline step 1: $.escape is not available');
        expect(inspect(error)).not.toContain(secret);

    });

    it('should keep a secret thrown by a render out of the message, the cause and the inspected error', async () => {

        const plan = await pipelineWithStep('one.sql.tmpl', `select {%~ (() => { throw new RangeError('${secret}'); })() %}`);
        const error = await failure(() => preparePipeline(ctx, plan));
        expect(error).toMatchObject({ code: 'PIPELINE_INVALID_DEFINITION', rule: 'step-prepare' });
        expect(error.message).not.toContain(secret);
        expect(error.cause).toMatchObject({ name: 'RangeError', message: 'Cause text withheld' });
        expect(inspect(error)).not.toContain(secret);

    });

});

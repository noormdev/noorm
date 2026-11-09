import { it } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TEST_CONNECTIONS, assertTestDatabase } from '../../utils/db.js';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Ancestor node_modules and inherited Node flags must not repair the installed package.
it('connects a packed SDK from plain Jest CommonJS and shares its runtime with ESM', async () => {

    assertTestDatabase(TEST_CONNECTIONS.postgres);
    const consumer = await mkdtemp(join(tmpdir(), 'noorm-sdk-postgres-consumer-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !key.startsWith('NOORM_') && key !== 'NODE_PATH' && key !== 'NODE_OPTIONS',
    ));
    const [, err] = await attempt(async () => {

        await exec('bun', ['run', 'build:packages'], {
            cwd: root,
            env,
            timeout: 240_000,
        });
        const packed = await exec('npm', [
            'pack', join(root, 'packages/sdk'), '--json', '--pack-destination', consumer,
        ], { cwd: consumer, env });
        const packages = JSON.parse(packed.stdout) as { filename: string }[];

        await writeFile(join(consumer, 'package.json'), JSON.stringify({
            name: 'sdk-postgres-consumer-test',
            version: '1.0.0',
            private: true,
            type: 'module',
        }));
        await exec('npm', [
            'install', '--ignore-scripts', '--no-audit', '--no-fund',
            join(consumer, packages[0]!.filename), 'pg@8.20.0', 'kysely@0.28.12', 'jest@30.4.2',
            'typescript@5.9.3', '@types/node',
        ], { cwd: consumer, env });
        await writeFile(join(consumer, 'verify-connection.cjs'), `
const assert = require('node:assert/strict');
const sdk = require('@noormdev/sdk');
const { sql } = require('kysely');

module.exports = async function verifyConnection() {
    assert.equal(process.execArgv.some(arg => arg.includes('experimental-vm-modules')), false);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    assert.equal(require.cache[require.resolve('pg')], undefined);
    for (const driver of ['mysql2', 'tedious', 'better-sqlite3']) {
        assert.throws(() => require.resolve(driver), { code: 'MODULE_NOT_FOUND' });
    }
    const config = JSON.parse(process.env.SDK_POSTGRES_TEST_CONFIG);
    let calls = 0;
    const ctx = await sdk.createContext({
        projectRoot: process.cwd(),
        connection: {
            ...config,
            pool: { max: 1 },
            password: async () => {
                calls++;
                return config.password;
            },
        },
    });
    assert.ok(ctx instanceof sdk.Context);
    assert.throws(() => ctx.kysely, sdk.NotConnectedError);
    assert.equal(ctx.noorm.config.connection.password, undefined);
    assert.equal(calls, 0);
    assert.equal(require.cache[require.resolve('pg')], undefined);
    const opened = [];
    const closed = [];
    const stopOpen = sdk.noormObserver.on('connection:open', event => opened.push(event));
    const stopClose = sdk.noormObserver.on('connection:close', event => closed.push(event));
    try {
        await ctx.connect({ retries: 1, delay: 0 });
        assert.equal(ctx.connected, true);
        const result = await sql\`SELECT 42::integer AS answer\`.execute(ctx.kysely);
        assert.equal(result.rows[0].answer, 42);
        assert.equal(calls, 1);
        assert.equal(opened.length, 1);
        assert.equal(opened[0].dialect, 'postgres');
    }
    finally {
        try {
            await ctx.disconnect();
        }
        finally {
            stopOpen();
            stopClose();
        }
    }
    assert.equal(ctx.connected, false);
    assert.equal(closed.length, 1);
    assert.throws(() => ctx.kysely, sdk.NotConnectedError);

    const failure = new Error('credential callback rejected');
    let failures = 0;
    const rejected = await sdk.createContext({
        projectRoot: process.cwd(),
        connection: {
            ...config,
            password: async () => {
                failures++;
                throw failure;
            },
        },
    });
    const errors = [];
    const stopError = sdk.noormObserver.on('connection:error', event => errors.push(event));
    try {
        await assert.rejects(rejected.connect({ retries: 3, delay: 0 }), error => error === failure);
        assert.equal(failures, 1);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].error, 'Runtime credential connection failed');
    }
    finally {
        stopError();
        await rejected.disconnect();
    }
};
`);
        await writeFile(join(consumer, 'consumer.test.cjs'), `
const verifyConnection = require('./verify-connection.cjs');

test('requires the installed SDK and lazily connects to PostgreSQL without VM modules', async () => {
    await verifyConnection();
}, 30000);
`);
        await writeFile(join(consumer, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '@noormdev/sdk';
import verifyConnection from './verify-connection.cjs';

const require = createRequire(import.meta.url);
const cjs = require('@noormdev/sdk');
const namedExports = Object.keys(esm).filter(key => key !== 'default').sort();
assert.deepEqual(namedExports, Object.keys(cjs).filter(key => key !== '__esModule').sort());
for (const key of namedExports) {
    assert.equal(esm[key], cjs[key], key + ' must share runtime identity');
}
assert.equal(esm.Context, cjs.Context);
assert.equal(esm.NotConnectedError, cjs.NotConnectedError);
assert.equal(esm.noormObserver, cjs.noormObserver);
await verifyConnection();
console.log('packed SDK shared CJS/ESM runtime passed');
`);

        const consumerEnv = {
            ...env,
            SDK_POSTGRES_TEST_CONFIG: JSON.stringify(TEST_CONNECTIONS.postgres),
        };
        await exec('node', [
            'node_modules/jest/bin/jest.js', '--runInBand', '--config', JSON.stringify({
                testEnvironment: 'node',
                transform: {},
                testMatch: ['**/consumer.test.cjs'],
            }),
        ], { cwd: consumer, env: consumerEnv, timeout: 45_000 });

        await exec('node', ['consumer.mjs'], {
            cwd: consumer,
            env: consumerEnv,
            timeout: 30_000,
        });
        const types = `
import { createContext } from '@noormdev/sdk';
import cjs = require('@noormdev/sdk');
import type {
    Context, CreateContextOptions, NoormOps, ChangesNamespace, NotConnectedError,
    ViewSummary, ProcedureSummary, FunctionSummary, TypeSummary, IndexSummary,
    ForeignKeySummary, ViewDetail, FunctionDetail, TypeDetail, TruncateOptions,
    ProcedureDetail, ColumnDetail, ParameterDetail,
} from '@noormdev/sdk';
import type { Context as EsmContext } from '@noormdev/sdk' with { 'resolution-mode': 'import' };

export type PublicSurface = [
    ViewSummary, ProcedureSummary, FunctionSummary, TypeSummary, IndexSummary,
    ForeignKeySummary, ViewDetail, FunctionDetail, TypeDetail, TruncateOptions,
    ProcedureDetail, ColumnDetail, ParameterDetail,
];

export async function context() {
    const ctx = await createContext({
        connection: { dialect: 'postgres', database: 'noorm_test' },
    });
    const dialect: string = ctx.dialect;
    await ctx.disconnect();
    return dialect;
}

// In .cts, the static type import resolves through require while import() uses import.
// In .mts, import = require still exercises require alongside the static ESM import.
// Dynamic import is required to select the import condition from the .cts consumer.
export async function mixedConditions() {
    const esm = await import('@noormdev/sdk');
    const esmExports: typeof esm = cjs;
    const cjsExports: typeof cjs = esm;
    const options: CreateContextOptions = {
        connection: { dialect: 'postgres', database: 'noorm_test' },
    };

    const staticContext: Context = await esm.createContext(options);
    const cjsContext: cjs.Context = await esm.createContext(options);
    const esmContext: EsmContext = await cjs.createContext(options);
    const staticToEsm: EsmContext = await createContext(options);

    const staticOps: NoormOps = esmContext.noorm;
    const cjsOps: cjs.NoormOps = esmContext.noorm;
    const esmOps: InstanceType<typeof esm.NoormOps> = cjsContext.noorm;
    const staticChanges: ChangesNamespace = esmOps.changes;
    const cjsChanges: cjs.ChangesNamespace = esmOps.changes;
    const esmChanges: InstanceType<typeof esm.ChangesNamespace> = cjsOps.changes;

    const staticError: NotConnectedError = new esm.NotConnectedError();
    const cjsError: cjs.NotConnectedError = new esm.NotConnectedError();
    const esmError: InstanceType<typeof esm.NotConnectedError> = new cjs.NotConnectedError();

    return {
        esmExports, cjsExports, staticContext, cjsContext, esmContext, staticToEsm,
        staticOps, cjsOps, esmOps, staticChanges, cjsChanges, esmChanges,
        staticError, cjsError, esmError,
    };
}
`;
        await writeFile(join(consumer, 'consumer.mts'), types);
        await writeFile(join(consumer, 'consumer.cts'), types);
        await exec('node', [
            'node_modules/typescript/bin/tsc', '--noEmit', '--strict',
            '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022',
            'consumer.mts', 'consumer.cts',
        ], { cwd: consumer, env: consumerEnv, timeout: 30_000 });

        // Kysely's CJS and ESM declarations are incompatible, so the SDK's Kysely must match the
        // consumer's own kysely import under both modern ESM and node10 resolution.
        await writeFile(join(consumer, 'kysely-interop.ts'), `
import { sql, type Kysely } from 'kysely';
import { createContext } from '@noormdev/sdk';

export async function interop() {
    const ctx = await createContext({
        connection: { dialect: 'postgres', database: 'noorm_test' },
    });
    const db: Kysely<unknown> = ctx.kysely;

    await sql\`select 1\`.execute(ctx.kysely);

    return db;
}
`);
        for (const flags of [
            ['--module', 'NodeNext', '--moduleResolution', 'NodeNext'],
            ['--module', 'CommonJS', '--moduleResolution', 'Node10'],
        ]) {

            await exec('node', [
                'node_modules/typescript/bin/tsc', '--noEmit', '--strict', ...flags, '--target', 'ES2022',
                'kysely-interop.ts',
            ], { cwd: consumer, env: consumerEnv, timeout: 30_000 });

        }

    });

    await rm(consumer, { recursive: true, force: true });

    if (err) throw err;

}, 300_000);

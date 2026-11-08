import { expect, it } from 'bun:test';
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

// Ancestor node_modules must not supply dependencies to the installed consumer.
it('uses rotating MySQL credentials from a packed SDK with only mysql2 and kysely installed', async () => {

    assertTestDatabase(TEST_CONNECTIONS.mysql);
    const consumer = await mkdtemp(join(tmpdir(), 'noorm-sdk-mysql-consumer-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !key.startsWith('NOORM_') && key !== 'NODE_PATH',
    ));
    const [, err] = await attempt(async () => {

        await exec('bun', ['x', '--no-install', 'tsup', '--config', 'tsup.sdk.config.ts'], {
            cwd: root,
            env,
            timeout: 30_000,
        });

        const packed = await exec('npm', [
            'pack', join(root, 'packages/sdk'), '--json', '--pack-destination', consumer,
        ], { cwd: consumer, env });
        const packages = JSON.parse(packed.stdout) as { filename: string }[];
        expect(packages).toHaveLength(1);
        const filename = packages[0]!.filename;

        await writeFile(join(consumer, 'package.json'), JSON.stringify({
            name: 'sdk-mysql-consumer-test',
            version: '1.0.0',
            private: true,
            type: 'module',
        }));
        await exec('npm', [
            'install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund',
            join(consumer, filename), 'mysql2@^3.19.1', 'kysely@^0.28.12',
        ], { cwd: consumer, env });
        await writeFile(join(consumer, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createContext } from '@noormdev/sdk';
import { sql } from 'kysely';

const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('tarn'), { code: 'MODULE_NOT_FOUND' });
const config = JSON.parse(process.env.SDK_MYSQL_TEST_CONFIG);
let calls = 0;
const ctx = await createContext({
    projectRoot: process.cwd(),
    connection: {
        ...config,
        pool: { max: 2 },
        password: async () => {
            calls++;
            return config.password;
        },
    },
});
assert.equal(ctx.noorm.config.connection.password, undefined);
try {
    await ctx.connect({ retries: 1, delay: 0 });
    const rows = await Promise.all([
        sql\`SELECT CONNECTION_ID() AS id, SLEEP(0.2)\`.execute(ctx.kysely),
        sql\`SELECT CONNECTION_ID() AS id, SLEEP(0.2)\`.execute(ctx.kysely),
    ]);
    assert.notEqual(rows[0].rows[0].id, rows[1].rows[0].id);
    assert.equal(calls, 2);
    await sql\`SELECT 1\`.execute(ctx.kysely);
    assert.equal(calls, 2);
}
finally {
    await ctx.disconnect();
}
console.log('packed MySQL credential refresh passed');
`);

        const result = await exec('node', ['consumer.mjs'], {
            cwd: consumer,
            env: { ...env, SDK_MYSQL_TEST_CONFIG: JSON.stringify(TEST_CONNECTIONS.mysql) },
            timeout: 30_000,
        });

        expect(result.stdout).toContain('packed MySQL credential refresh passed');

    });

    await rm(consumer, { recursive: true, force: true });

    if (err) throw err;

}, 120_000);

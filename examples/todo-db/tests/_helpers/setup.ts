/**
 * Shared test-lifecycle setup.
 *
 * Two modes — same SDK context at the end, different provenance:
 *
 * 1. Local / default: tests own the bootstrap.
 *    - prepareTmpProject() copies sql/ + changes/ into tmp/test-root/
 *    - `ci identity new` mints an ephemeral keypair
 *    - env is primed (NOORM_IDENTITY_*, NOORM_CONNECTION_*)
 *    - test DB is dropped and rebuilt via `ci init` → `db create` →
 *      `db reset` → `change ff`
 *    - SDK context is then created against the tmp project
 *
 * 2. Prebuilt (NOORM_TEST_PREBUILT=1): CI owns the bootstrap.
 *    - The CI workflow has already run the same CLI chain against
 *      `exampleRoot` (examples/todo-db/) and exported NOORM_IDENTITY_*
 *      into the job env before invoking `bun test`.
 *    - Tests skip every mutating step and simply connect the SDK
 *      against the example root — proving the SDK can read state
 *      produced by a real `noorm ci` session instead of one minted in
 *      the same process.
 *
 * The whole build is memoised via `sharedCtxPromise` so a full `bun test`
 * pays the setup cost once per process.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Client } from 'pg';

import { createTestContext, getTestConnection, type TestContext } from './context.js';
import { exampleRoot, prepareTmpProject } from './project.js';

const CLI_BIN = resolve(exampleRoot, '..', '..', 'packages', 'cli', 'dist', 'index.js');

let sharedCtxPromise: Promise<TestContext> | null = null;

interface IdentityPayload {
    privateKey: string;
    name: string;
    email: string;
}

function runCli(projectRoot: string, argv: string[]): { stdout: string; stderr: string } {

    const result = spawnSync('node', [CLI_BIN, ...argv], {
        cwd: projectRoot,
        env: process.env,
        encoding: 'utf8',
    });

    if (result.status !== 0) {

        const stderr = (result.stderr ?? '').trim();
        const stdout = (result.stdout ?? '').trim();
        const cmd = `noorm ${argv.join(' ')}`;

        throw new Error(
            `CLI failed (${cmd}) with exit ${result.status}:\n  stdout: ${stdout}\n  stderr: ${stderr}`,
        );

    }

    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };

}

function mintIdentity(projectRoot: string): IdentityPayload {

    const name = 'todo-db-test';
    const email = 'test@noorm.local';

    const { stdout } = runCli(projectRoot, [
        'ci', 'identity', 'new',
        '--name', name,
        '--email', email,
        '--json',
    ]);

    const parsed = JSON.parse(stdout) as {
        data?: { privateKey?: string; name?: string; email?: string };
        privateKey?: string;
        name?: string;
        email?: string;
    };

    const payload = parsed.data ?? parsed;
    const privateKey = payload.privateKey;

    if (!privateKey) {

        throw new Error(`ci identity new did not return privateKey. Output: ${stdout}`);

    }

    return { privateKey, name, email };

}

function primeIdentityEnv(identity: IdentityPayload): void {

    process.env['NOORM_IDENTITY_PRIVATE_KEY'] = identity.privateKey;
    process.env['NOORM_IDENTITY_NAME'] = identity.name;
    process.env['NOORM_IDENTITY_EMAIL'] = identity.email;

}

async function dropTestDatabase(): Promise<void> {

    const conn = getTestConnection();

    const admin = new Client({
        host: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: 'postgres',
    });

    await admin.connect();

    // Terminate any leftover sessions so DROP DATABASE doesn't block on them.
    await admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [conn.database],
    );

    const quoted = `"${conn.database.replace(/"/g, '""')}"`;
    await admin.query(`DROP DATABASE IF EXISTS ${quoted}`);

    await admin.end();

}

async function buildContext(): Promise<TestContext> {

    const prebuilt = process.env['NOORM_TEST_PREBUILT'] === '1';

    if (prebuilt) {

        // CI has already run the full `noorm ci` + `db reset` + `change ff`
        // chain against exampleRoot and exported NOORM_IDENTITY_* into the
        // job env. All we do is connect the SDK against that existing state.
        const ctx = await createTestContext(exampleRoot);

        await ctx.connect();

        return ctx;

    }

    const projectRoot = prepareTmpProject();
    const identity = mintIdentity(projectRoot);

    primeIdentityEnv(identity);

    const conn = getTestConnection();

    await dropTestDatabase();

    runCli(projectRoot, [
        'ci', 'init',
        '--name', conn.database,
        '--force',
        '--json',
    ]);

    runCli(projectRoot, ['db', 'create', '--json']);
    runCli(projectRoot, ['db', 'reset', '--yes', '--json']);
    runCli(projectRoot, ['change', 'ff', '--yes', '--json']);

    const ctx = await createTestContext(projectRoot);

    await ctx.connect();

    return ctx;

}

/**
 * Returns a lazily-built, connected Context. Safe for any number of test
 * files to call — the first call does the schema build, the rest await the
 * memoised promise.
 */
export function getSharedContext(): Promise<TestContext> {

    if (!sharedCtxPromise) {

        sharedCtxPromise = buildContext();

    }

    return sharedCtxPromise;

}

/**
 * Close the shared context cleanly. Called from the bun:test preload's
 * teardown hook so Kysely pools don't keep the process alive.
 */
export async function disposeSharedContext(): Promise<void> {

    if (!sharedCtxPromise) return;

    const ctx = await sharedCtxPromise;

    await ctx.disconnect();

    sharedCtxPromise = null;

}

/**
 * Uniqueness helper for test data. The schema has tight unique constraints
 * (`user.username`, `user.email`, `category.name`, `tag.name`, etc.) — a
 * random suffix keeps tests in the same process run from colliding.
 */
export function uid(prefix: string): string {

    const rand = Math.random().toString(36).slice(2, 10);

    return `${prefix}-${rand}`;

}

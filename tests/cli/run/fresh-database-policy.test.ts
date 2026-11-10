/** Only a real run by a role that can record to the tracking tables may create them. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sql } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { CLI, extractJsonObject } from './_setup.js';

const CHANGE = '2026-01-01-add-gadget';
const TRACKING_PREFIX = '__noorm_';

describe('cli: tracking tables on a database that has none', () => {

    let dir: string;
    let home: string;
    let env: Record<string, string>;

    beforeEach(async () => {

        dir = await mkdtemp(join(tmpdir(), 'noorm-fresh-policy-'));
        home = await mkdtemp(join(tmpdir(), 'noorm-fresh-policy-home-'));

        await mkdir(join(dir, '.noorm'), { recursive: true });
        await writeFile(join(dir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n    changes: ./changes\n');
        await mkdir(join(dir, 'sql'), { recursive: true });
        await writeFile(join(dir, 'sql', 'widget.sql'), 'CREATE TABLE widget (id INTEGER PRIMARY KEY);');

        const change = join(dir, 'changes', CHANGE);
        await mkdir(join(change, 'change'), { recursive: true });
        await mkdir(join(change, 'revert'), { recursive: true });
        await writeFile(join(change, 'change', '001_gadget.sql'), 'CREATE TABLE gadget (id INTEGER PRIMARY KEY);');
        await writeFile(join(change, 'revert', '001_gadget.sql'), 'DROP TABLE gadget;');

        const privateKey = generateKeyPair().privateKey;
        const state = new StateManager(dir, { privateKey });
        await state.load();

        // `viewer` and `admin` share one database; `other` is a second one for the two-config commands.
        for (const [name, role, file] of [['viewer', 'viewer', 'main.db'], ['admin', 'admin', 'main.db'], ['other', 'admin', 'other.db']] as const) {

            await state.setConfig(name, {
                name, type: 'local', isTest: false, access: { user: role, agent: false },
                connection: { dialect: 'sqlite', database: join(dir, file) },
            });

        }

        env = {
            ...Object.fromEntries(Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('NOORM_'),
            )),
            HOME: home,
            NOORM_CHANNEL: 'user',
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        };

    });

    afterEach(async () => {

        await rm(dir, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });

    });

    function run(config: string, ...args: string[]) {

        const result = spawnSync('node', [CLI, ...args, '--config', config], { cwd: dir, encoding: 'utf-8', env });

        return { status: result.status, output: `${result.stdout}${result.stderr}`, stdout: result.stdout };

    }

    async function tables(file = 'main.db'): Promise<string[]> {

        const conn = await createConnection({ dialect: 'sqlite', database: join(dir, file) }, '__test__');
        const found = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(conn.db);

        await conn.destroy();

        return found.rows.map((row) => row.name);

    }

    async function setTrackingVersion(version: number): Promise<void> {

        const conn = await createConnection({ dialect: 'sqlite', database: join(dir, 'main.db') }, '__test__');
        await sql`UPDATE __noorm_version__ SET noorm_version = ${version}`.execute(conn.db);
        await conn.destroy();

    }

    describe('as a role that cannot write', () => {

        it.each([
            ['lock acquire', ['lock', 'acquire'], '"lock:acquire" is not allowed on config "viewer" (role: viewer)'],
            ['run build', ['run', 'build'], '"run:build" is not allowed on config "viewer" (role: viewer)'],
            ['change ff', ['change', 'ff'], '"change:ff" is not allowed on config "viewer" (role: viewer)'],
        ])('should refuse %s and create no tables', async (_command, args, refusal) => {

            const result = run('viewer', ...args);

            expect(result.status).toBe(1);
            expect(result.output).toContain(refusal);
            expect(await tables()).toEqual([]);

        });

        it.each([
            ['change history', ['change', 'history'], 'Execution History: 0 records'],
            ['change list', ['change', 'list'], `${CHANGE} (pending)`],
            ['lock status', ['lock', 'status'], 'No active lock'],
            ['pipeline history', ['pipeline', 'history', 'refresh'], 'No pipeline runs found'],
            ['db explore', ['db', 'explore'], 'Tables:       0'],
            ['db explore tables', ['db', 'explore', 'tables'], 'Tables: 0'],
            ['sql query', ['sql', 'query', 'SELECT 1 AS one'], 'one'],
        ])('should read %s as empty and create no tables', async (_command, args, expected) => {

            const result = run('viewer', ...args);

            expect(result.output).not.toContain('no such table');
            expect(result.output).toContain(expected);
            expect(result.status).toBe(0);
            expect(await tables()).toEqual([]);

        });

        it('should say who has to migrate tracking tables it cannot migrate itself', async () => {

            expect(run('admin', 'run', 'build').status).toBe(0);
            await setTrackingVersion(1);

            const result = run('viewer', 'change', 'history');

            expect(result.status).not.toBe(0);
            expect(result.output).toContain('a role that can write must run a command once first');
            expect(result.output).not.toContain('--dry-run');

        });

    });

    describe('as a role that can write', () => {

        it('should create the tracking tables on a read', async () => {

            const result = run('admin', 'change', 'history');

            expect(result.status).toBe(0);
            expect(await tables()).toContain('__noorm_change__');

        });

        it('should render run exec --dry-run and create no tables', async () => {

            const result = run('admin', 'run', 'exec', 'sql/*.sql', '--dry-run');

            expect(result.status).toBe(0);
            expect(result.output).toContain('widget.sql');
            expect(await tables()).toEqual([]);

        });

        // A dry run answers what the real revert would: a change that was never applied cannot be reverted.
        it('should refuse change revert --dry-run of an unapplied change and create no tables', async () => {

            const result = run('admin', 'change', 'revert', CHANGE, '--dry-run');

            expect(result.status).toBe(1);
            expect(result.output).toContain(`Cannot revert '${CHANGE}': not applied`);
            expect(result.output).not.toContain('reverted (success');
            expect(await tables()).toEqual([]);

        });

        it('should leave an applied change applied on change revert --dry-run', async () => {

            expect(run('admin', 'change', 'ff').status).toBe(0);

            const result = run('admin', 'change', 'revert', CHANGE, '--dry-run', '--json');
            const payload = JSON.parse(extractJsonObject(result.stdout) ?? '{}');
            const history = JSON.parse(extractJsonObject(run('admin', 'change', 'list', '--json').stdout) ?? '{}');

            expect(result.status).toBe(0);
            expect(payload).toMatchObject({ success: true, dryRun: true, name: CHANGE, direction: 'revert' });
            expect(await tables()).toContain('gadget');
            expect(history.changes.map((change: { status: string }) => change.status)).toEqual(['success']);

        });

        // SQLite cannot transfer, so the plan fails; what matters here is that planning it wrote nothing.
        it('should create no tables in either database on db transfer --dry-run', async () => {

            const result = run('admin', 'db', 'transfer', '--to', 'other', '--dry-run');

            expect(result.status).toBe(1);
            expect(result.output).toContain('Transfer not supported for dialect: sqlite');
            expect(await tables()).toEqual([]);
            expect(await tables('other.db')).toEqual([]);

        });

        it('should report no vault on vault cp --dry-run and create no tables in either database', async () => {

            const result = spawnSync('node', [CLI, 'vault', 'cp', 'API_KEY', 'admin', 'other', '--dry-run'], { cwd: dir, encoding: 'utf-8', env });
            const output = `${result.stdout}${result.stderr}`;

            expect(result.status).toBe(1);
            expect(output).toContain('No vault access on source config "admin"');
            expect(output).not.toContain('no such table');
            expect((await tables()).filter((name) => name.startsWith(TRACKING_PREFIX))).toEqual([]);
            expect(await tables('other.db')).toEqual([]);

        });

    });

});

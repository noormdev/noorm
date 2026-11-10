/** Activating a config syncs identity with its database; a role that cannot record there must leave it untouched. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sql } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import { CURRENT_VERSIONS } from '../../../src/core/version/types.js';
import { CLI } from '../run/_setup.js';

const OLDER = CURRENT_VERSIONS.schema - 1;

describe('cli: config use and the tracking tables', () => {

    let dir: string;
    let home: string;
    let privateKey: string;
    let env: Record<string, string>;

    beforeEach(async () => {

        dir = await mkdtemp(join(tmpdir(), 'noorm-use-policy-'));
        home = await mkdtemp(join(tmpdir(), 'noorm-use-policy-home-'));

        await mkdir(join(dir, '.noorm'), { recursive: true });
        await writeFile(join(dir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n    changes: ./changes\n');

        privateKey = generateKeyPair().privateKey;
        const state = new StateManager(dir, { privateKey });
        await state.load();

        const configs = [
            ['viewer', { user: 'viewer', agent: 'viewer' }, 'main.db'],
            ['operator', { user: 'operator', agent: 'viewer' }, 'main.db'],
            ['admin', { user: 'admin', agent: 'viewer' }, 'main.db'],
            ['agentoff', { user: 'admin', agent: false }, 'hidden.db'],
        ] as const;

        for (const [name, access, file] of configs) {

            await state.setConfig(name, {
                name, type: 'local', isTest: false, access,
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

    function use(config: string, channel: 'user' | 'agent' = 'user') {

        const result = spawnSync('node', [CLI, 'config', 'use', config], {
            cwd: dir, encoding: 'utf-8', env: { ...env, NOORM_CHANNEL: channel },
        });

        return { status: result.status, output: `${result.stdout}${result.stderr}` };

    }

    async function query<T>(statement: ReturnType<typeof sql<T>>): Promise<T[]> {

        const conn = await createConnection({ dialect: 'sqlite', database: join(dir, 'main.db') }, '__test__');
        const found = await statement.execute(conn.db);

        await conn.destroy();

        return found.rows;

    }

    const tables = async () => (await query(sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => row.name);
    const identities = () => query(sql<{ email: string }>`SELECT email FROM __noorm_identities__`);
    const versions = async () => (await query(sql<{ noorm_version: number }>`SELECT noorm_version FROM __noorm_version__`))
        .map((row) => row.noorm_version);

    async function activeConfig(): Promise<string | null> {

        const state = new StateManager(dir, { privateKey });
        await state.load();

        return state.getActiveConfigName();

    }

    /** Tracking tables with no registered identity, as another person's bootstrap would leave them. */
    async function seedTables(version: number): Promise<void> {

        expect(use('admin').status).toBe(0);

        await query(sql`DELETE FROM __noorm_identities__`);
        await query(sql`UPDATE __noorm_version__ SET noorm_version = ${version}`);

    }

    describe('on a database with no tracking tables', () => {

        it('should create them and register the identity for a role that can write', async () => {

            const result = use('admin');

            expect(result.status).toBe(0);
            expect(await tables()).toContain('__noorm_identities__');
            expect(await identities()).toEqual([{ email: 'ci@example.com' }]);

        });

        it('should activate a viewer config and create no tables', async () => {

            const result = use('viewer');

            expect(result.status).toBe(0);
            expect(result.output).toContain('Active config set to: viewer');
            expect(await tables()).toEqual([]);

        });

        it('should create no tables for an agent whose role on the config is viewer', async () => {

            const result = use('operator', 'agent');

            expect(result.status).toBe(0);
            expect(await tables()).toEqual([]);

        });

        it('should refuse an agent a config hidden from it, without activating or connecting', async () => {

            expect(use('viewer').status).toBe(0);

            const result = use('agentoff', 'agent');

            expect(result.status).not.toBe(0);
            expect(result.output).toContain('Config "agentoff" is not accessible on the agent channel.');
            expect(result.output).not.toContain('Active config set to');
            expect(await activeConfig()).toBe('viewer');
            expect(existsSync(join(dir, 'hidden.db'))).toBe(false);

        });

    });

    describe('on tracking tables another identity created', () => {

        it('should not register a viewer', async () => {

            await seedTables(CURRENT_VERSIONS.schema);

            const result = use('viewer');

            expect(result.status).toBe(0);
            expect(await identities()).toEqual([]);

        });

        it('should register a role that can write', async () => {

            await seedTables(CURRENT_VERSIONS.schema);

            expect(use('operator').status).toBe(0);
            expect(await identities()).toEqual([{ email: 'ci@example.com' }]);

        });

        it('should leave an older layout unmigrated for a viewer', async () => {

            await seedTables(OLDER);

            const result = use('viewer');

            expect(result.status).toBe(0);
            expect(await versions()).toEqual([OLDER]);
            expect(await identities()).toEqual([]);

        });

        it('should migrate an older layout for a role that can write', async () => {

            await seedTables(OLDER);

            expect(use('admin').status).toBe(0);
            expect(await versions()).toContain(CURRENT_VERSIONS.schema);

        });

    });

});

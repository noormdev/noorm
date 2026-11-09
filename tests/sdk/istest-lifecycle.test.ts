/** isTest contexts tear down on the agent channel; others keep refusing. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';

import { Context, createContext } from '../../src/sdk/index.js';
import { bindSdkDestination, bindSdkPolicy, ProtectedConfigError } from '../../src/sdk/guards.js';
import { getConfigPermission } from '../../src/core/policy/index.js';
import type { Config } from '../../src/core/config/types.js';
import type { ContextState } from '../../src/sdk/state.js';
import { resetStateManager } from '../../src/core/state/index.js';
import { loadedStateManager } from '../utils/state-manager.js';

describe('sdk: isTest db lifecycle on the agent channel', () => {

    let root: string;
    let ctx: Context | undefined;
    let envBackup: string | undefined;

    beforeEach(async () => {

        root = await mkdtemp(join(tmpdir(), 'noorm-istest-sdk-'));
        envBackup = process.env['NOORM_isTest'];

    });

    afterEach(async () => {

        await ctx?.disconnect();
        ctx = undefined;
        resetStateManager();

        if (envBackup === undefined) delete process.env['NOORM_isTest'];
        else process.env['NOORM_isTest'] = envBackup;

        await rm(root, { recursive: true, force: true });

    });

    async function open() {

        ctx = await createContext({
            projectRoot: root,
            freshState: true,
            channel: 'agent',
            connection: { dialect: 'sqlite', database: join(root, 'test.db') },
        });
        await ctx.connect();
        await sql`CREATE TABLE widget (id INTEGER PRIMARY KEY)`.execute(ctx.kysely);

        return ctx;

    }

    it('should tear down without confirmation when the config is isTest', async () => {

        process.env['NOORM_isTest'] = 'true';
        const { noorm, kysely } = await open();

        await noorm.db.teardown();

        const left = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'widget'`.execute(kysely);
        expect(left.rows).toHaveLength(0);

    });

    it('should refuse reset before dropping anything when the role cannot run:build', async () => {

        process.env['NOORM_isTest'] = 'true';
        const { noorm, kysely } = await open();

        await expect(noorm.db.reset()).rejects.toThrow(ProtectedConfigError);

        const left = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'widget'`.execute(kysely);
        expect(left.rows).toHaveLength(1);

    });

    it('should refuse reset before dropping anything when run:build still needs a confirmation the caller did not give', async () => {

        const config = bindSdkPolicy(
            {
                name: 'test',
                type: 'local',
                isTest: true,
                access: { user: 'operator', agent: 'viewer' },
                connection: { dialect: 'sqlite', database: join(root, 'test.db') },
            } satisfies Config,
            {},
            root,
            undefined,
            true,
        );
        ctx = new Context(config, {}, { name: 'tester', source: 'system' }, { channel: 'user' }, root);
        await ctx.connect();
        await sql`CREATE TABLE widget (id INTEGER PRIMARY KEY)`.execute(ctx.kysely);

        await expect(ctx.noorm.db.reset()).rejects.toThrow(ProtectedConfigError);

        const left = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'widget'`.execute(ctx.kysely);
        expect(left.rows).toHaveLength(1);

    });

    it('should refuse teardown when the config is not isTest', async () => {

        delete process.env['NOORM_isTest'];
        const { noorm } = await open();

        await expect(noorm.db.teardown()).rejects.toThrow(ProtectedConfigError);

    });

    describe('transfer and vault destinations', () => {

        async function destination(stored: boolean): Promise<{ config: Config; state: ContextState }> {

            const config: Config = {
                name: 'dest',
                type: 'local',
                isTest: true,
                access: { user: 'viewer', agent: 'viewer' },
                connection: { dialect: 'sqlite', database: ':memory:' },
            };
            const stateManager = await loadedStateManager();
            await stateManager.setConfig(config.name, { ...config, isTest: stored });
            const state: ContextState = {
                connection: null,
                config,
                settings: {},
                identity: { name: 'tester', source: 'system' },
                options: { channel: 'agent' },
                projectRoot: root,
                stateManager,
                changeManager: null,
            };

            return { config, state };

        }

        it('should carry the stored destination isTest into db:reset', async () => {

            const { config, state } = await destination(true);

            expect(getConfigPermission('agent', bindSdkDestination(config, state), 'db:reset')).toBe('allow');

        });

        it('should ignore an isTest the caller set on a destination that is stored as not isTest', async () => {

            const { config, state } = await destination(false);

            expect(getConfigPermission('agent', bindSdkDestination(config, state), 'db:reset')).toBe('deny');

        });

        it('should not relax a destination whose connection was retargeted away from the stored one', async () => {

            const { config, state } = await destination(true);
            const retargeted: Config = { ...config, connection: { dialect: 'sqlite', database: '/data/prod.db' } };

            expect(getConfigPermission('agent', bindSdkDestination(retargeted, state), 'db:reset')).toBe('deny');

        });

    });

    describe('rebinding a resolved config', () => {

        const bound = (): Config => bindSdkPolicy(
            {
                name: 'test',
                type: 'local',
                isTest: true,
                access: { user: 'viewer', agent: 'viewer' },
                connection: { dialect: 'sqlite', database: join(root, 'test.db') },
            } satisfies Config,
            {},
            root,
            undefined,
            true,
        );

        it('should keep the relaxation when the connection is unchanged', () => {

            const config = bound();

            expect(getConfigPermission('agent', bindSdkPolicy(config, {}, root), 'db:destroy')).toBe('allow');

        });

        it('should keep the relaxation when only credentials change', () => {

            const config = bound();
            const rebound: Config = { ...config, connection: { ...config.connection, user: 'other', password: 'pw' } };

            expect(getConfigPermission('agent', bindSdkPolicy(rebound, {}, root), 'db:destroy')).toBe('allow');

        });

        it('should not carry the relaxation onto a retargeted connection', () => {

            const config = bound();
            const retargeted: Config = { ...config, connection: { dialect: 'sqlite', database: '/data/prod.db' } };

            expect(getConfigPermission('agent', bindSdkPolicy(retargeted, {}, root), 'db:destroy')).not.toBe('allow');

        });

    });

});

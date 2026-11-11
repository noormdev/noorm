/** Anchoring runs after policy binding, so the fingerprint hashes the path as written and the connection reads under the project root. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attempt } from '@logosdx/utils';

import { Context } from '../../src/sdk/context.js';
import { createContext } from '../../src/sdk/index.js';
import { bindSdkDestination } from '../../src/sdk/guards.js';
import { SslFileError } from '../../src/core/connection/ssl-files.js';
import {
    attachPolicyContext,
    getPolicyContext,
    policyTargetIdentity,
    withPolicyConfirmation,
} from '../../src/core/policy/index.js';
import { generateKeyPair } from '../../src/core/identity/crypto.js';
import { clearKeyOverride, setKeyOverride } from '../../src/core/identity/storage.js';
import { StateManager } from '../../src/core/state/index.js';

import type { Config } from '../../src/core/config/types.js';
import type { ContextState } from '../../src/sdk/state.js';

const settings: ContextState['settings'] = {
    access: { roles: { reviewer: { permissions: { 'db:reset': 'confirm', 'run:build': 'allow' } } } },
};
const identity = { name: 'tester', source: 'system' } as const;

describe('sdk: ssl file anchoring', () => {

    let stateRoot: string;
    let root: string;
    let stateManager: StateManager;

    beforeAll(async () => {

        stateRoot = mkdtempSync(join(tmpdir(), 'noorm-sdk-anchor-state-'));
        root = mkdtempSync(join(tmpdir(), 'noorm-sdk-anchor-root-'));
        stateManager = new StateManager(stateRoot, { privateKey: generateKeyPair().privateKey });

        await stateManager.load();

    });

    afterAll(() => {

        rmSync(stateRoot, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });

    });

    function configWith(ssl: object, withAccess = true): Config {

        return {
            name: 'ci',
            type: 'remote',
            isTest: false,
            ...(withAccess ? { access: { user: 'reviewer', agent: 'reviewer' } } : {}),
            connection: { dialect: 'postgres', host: '127.0.0.1', port: 1, database: 'app', ssl },
        };

    }

    function contextFor(config: Config): Context {

        return new Context(config, settings, identity, { channel: 'agent' }, root, stateManager);

    }

    /** `certs/ca.pem` is a directory under the root: refused as not-a-regular-file with the path it tried. */
    async function connectError(config: Config): Promise<unknown> {

        mkdirSync(join(root, 'certs', 'ca.pem'), { recursive: true });

        const ctx = contextFor(config);
        const [, err] = await attempt(() => ctx.connect({ retries: 1, delay: 1 }));

        return err;

    }

    it('should read a relative caFile under the project root, for a config with access', async () => {

        const err = await connectError(configWith({ caFile: 'certs/ca.pem' }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('path', join(root, 'certs', 'ca.pem'));

    });

    it('should read a relative caFile under the project root, for a config without access', async () => {

        const err = await connectError(configWith({ caFile: 'certs/ca.pem' }, false));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('path', join(root, 'certs', 'ca.pem'));

    });

    it('should leave a ~/ path as written', () => {

        const ctx = contextFor(configWith({ caFile: '~/certs/ca.pem' }));

        expect(ctx.noorm.config.connection.ssl).toEqual({ caFile: '~/certs/ca.pem' });

    });

    it('should leave an absolute path as written', async () => {

        const caFile = join(root, 'certs', 'ca.pem');
        const err = await connectError(configWith({ caFile }));

        expect(err).toBeInstanceOf(SslFileError);
        expect(err).toHaveProperty('path', caFile);

    });

    it('should bind the fingerprint of the path as written, not the anchored one', async () => {

        const expected = configWith({ caFile: 'certs/ca.pem' });

        attachPolicyContext(expected.access, {
            roles: settings.access?.roles,
            protectedStage: false,
            targetIdentity: policyTargetIdentity(root, expected.connection),
        });

        const ctx = contextFor(configWith({ caFile: 'certs/ca.pem' }));
        const [, err] = await attempt(() => withPolicyConfirmation(expected, ['db:reset'], () => ctx.noorm.db.reset()));

        expect(err?.message).toBe('Not connected. Call connect() first.');

    });

    it('should anchor and fingerprint as written for a config: false inline connection', async () => {

        setKeyOverride(generateKeyPair().privateKey);

        const connection = { dialect: 'postgres' as const, host: '127.0.0.1', port: 1, database: 'app', ssl: { caFile: 'certs/ca.pem' } };
        const [ctx, err] = await attempt(() => createContext({ config: false, connection, projectRoot: root, freshState: true }));

        clearKeyOverride();

        expect(err).toBeNull();

        if (!ctx) return;

        expect(ctx.noorm.config.connection.ssl).toEqual({ caFile: join(root, 'certs', 'ca.pem') });
        expect(getPolicyContext(ctx.noorm.config.access)?.targetIdentity).toBe(
            policyTargetIdentity(root, { ...ctx.noorm.config.connection, ssl: connection.ssl }),
        );

    });

    describe('bindSdkDestination', () => {

        async function bind(config: Config): Promise<Config> {

            const state: ContextState = {
                connection: null,
                config: configWith({}),
                settings,
                identity,
                options: { channel: 'agent' },
                projectRoot: root,
                stateManager,
                changeManager: null,
            };

            return bindSdkDestination(config, state);

        }

        it('should hold anchored paths and keep the bound target identity of the path as written', async () => {

            const ssl = { caFile: 'certs/ca.pem', certFile: '~/c.pem' };
            const destination = await bind(configWith(ssl));

            expect(destination.connection.ssl).toEqual({ caFile: join(root, 'certs', 'ca.pem'), certFile: '~/c.pem' });
            expect(destination.access).toBeDefined();
            expect(getPolicyContext(destination.access)?.targetIdentity).toBe(
                policyTargetIdentity(root, configWith(ssl).connection),
            );

        });

    });

});

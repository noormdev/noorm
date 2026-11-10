/** Approvals are keyed by policy fingerprint, so every attach site must bind the same context. */
import { describe, it, expect, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { Context } from '../../src/sdk/context.js';
import { TransferNamespace } from '../../src/sdk/namespaces/transfer.js';
import { VaultNamespace } from '../../src/sdk/namespaces/vault.js';
import { SettingsProvider, withConfigPolicy } from '../../src/core/config/resolver.js';
import {
    attachPolicyContext,
    checkConfigPolicy,
    getPolicyContext,
    policyTargetIdentity,
    withPolicyConfirmation,
} from '../../src/core/policy/index.js';
import { resetStateManager } from '../../src/core/state/index.js';
import { loadedStateManager } from '../utils/state-manager.js';

import type { Config } from '../../src/core/config/types.js';
import type { SettingsManager } from '../../src/core/settings/index.js';
import type { ContextState } from '../../src/sdk/state.js';

const ROOT = '/tmp/policy-attach';

const settings: ContextState['settings'] = {
    access: {
        roles: { reviewer: { permissions: { 'db:reset': 'confirm', 'run:build': 'allow', 'vault:read': 'allow', 'vault:write': 'confirm' } } },
    },
};

function makeConfig(name: string, protectedStage?: boolean, role = 'reviewer'): Config {

    const config: Config = {
        name,
        type: 'local',
        isTest: false,
        access: { user: role, agent: role },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

    if (protectedStage !== undefined) attachPolicyContext(config.access, { protectedStage });

    return config;

}

/** The config as the resolver would bind it for a role with confirm cells. */
function fullyBound(name: string, protectedStage = false, projectRoot = ROOT): Config {

    const config = makeConfig(name);
    attachPolicyContext(config.access, {
        roles: settings.access?.roles,
        protectedStage,
        targetIdentity: policyTargetIdentity(projectRoot, config.connection),
    });

    return config;

}

// Destinations look up their stored config by name; none are stored here.
const stateManager = await loadedStateManager();

function makeState(config: Config): ContextState {

    attachPolicyContext(config.access, { roles: settings.access?.roles });

    return {
        connection: null,
        config,
        settings,
        identity: { name: 'tester', source: 'system' },
        options: { channel: 'agent' },
        projectRoot: ROOT,
        stateManager,
        changeManager: null,
    };

}

function providerFor(): SettingsProvider {

    const manager: Pick<SettingsManager, 'projectRoot' | 'settings' | 'getStage'> = {
        projectRoot: ROOT,
        settings,
        getStage: () => undefined,
    };

    return new SettingsProvider(manager as SettingsManager);

}

const CTX_AFTER_GATE = 'Not connected. Call connect() first.';
const TRANSFER_AFTER_GATE = /Transfer not supported for dialect: sqlite/;
// Past the gate, copy fails on the identity lookup: no identity file in CI, no vault in the source locally.
const VAULT_AFTER_GATE = /No vault access on source config "source"|require a cryptographic identity/;

describe('sdk: policy context attach', () => {

    afterEach(() => resetStateManager());

    describe('resolver-bound protectedStage', () => {

        it('should be kept on a transfer destination whose name is not a protected stage', async () => {

            const transfer = new TransferNamespace(makeState(makeConfig('source')));
            const destination = makeConfig('staging', true, 'admin');

            await expect(transfer.to(destination)).rejects.toThrow(/db:reset.*not allowed/);

        });

        it('should be kept on a vault copy destination whose name is not a protected stage', async () => {

            const vault = new VaultNamespace(makeState(makeConfig('source')));
            const destination = makeConfig('staging', true, 'admin');

            await expect(vault.copy(destination, ['API_KEY'], 'key')).rejects.toThrow(/vault:write.*not allowed/);

        });

    });

    describe('withConfigPolicy', () => {

        it('should keep an already-bound protectedStage when no stage is protected', () => {

            const resolved = withConfigPolicy(makeConfig('staging', true), providerFor());

            expect(getPolicyContext(resolved.access)?.protectedStage).toBe(true);

        });

    });

    describe('fingerprint', () => {

        const grant = <T>(name: string, permission: 'db:reset' | 'vault:write', action: () => Promise<T>) =>
            withPolicyConfirmation(fullyBound(name), [permission, 'vault:read'], action);

        it('should match the fully-bound config when attached by the resolver', async () => {

            const resolved = withConfigPolicy(makeConfig('dev'), providerFor());

            const check = await grant('dev', 'db:reset', async () => checkConfigPolicy('agent', resolved, 'db:reset'));

            expect(check.allowed).toBe(true);

        });

        it('should match the fully-bound config when attached by createContext', async () => {

            const ctx = new Context(makeConfig('dev'), settings, { name: 'tester', source: 'system' }, { channel: 'agent' }, ROOT);

            const [, err] = await attempt(() => grant('dev', 'db:reset', () => ctx.noorm.db.reset()));

            expect(err?.message).toBe(CTX_AFTER_GATE);

        });

        it('should match the fully-bound config when attached to a transfer destination', async () => {

            const transfer = new TransferNamespace(makeState(makeConfig('source')));

            const [, err] = await attempt(() => grant('dev', 'db:reset', () => transfer.to(makeConfig('dev'))));

            expect(err?.message).toMatch(TRANSFER_AFTER_GATE);

        });

        it('should match the fully-bound config when attached to a vault copy destination', async () => {

            const vault = new VaultNamespace(makeState(makeConfig('source')));

            const [, err] = await attempt(() => grant('dev', 'vault:write', () => vault.copy(makeConfig('dev'), ['API_KEY'], 'key')));

            expect(err?.message).toMatch(VAULT_AFTER_GATE);

        });

        it('should not match a grant bound to a different project root', async () => {

            const ctx = new Context(makeConfig('dev'), settings, { name: 'tester', source: 'system' }, { channel: 'agent' }, ROOT);
            const other = fullyBound('dev', false, '/tmp/elsewhere');

            const [, err] = await attempt(() => withPolicyConfirmation(other, ['db:reset', 'vault:read'], () => ctx.noorm.db.reset()));

            expect(err?.message).toMatch(/confirmation/);

        });

    });

});

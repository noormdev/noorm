/**
 * SDK TransferNamespace/DtNamespace throw-not-tuple contract tests.
 *
 * `transfer.to`/`transfer.plan`/`dt.exportTable`/`dt.importFile` used to
 * return `[value, error]` tuples; this ticket converts them to throw.
 * `transfer.to`/`transfer.plan` validate dialect support before opening
 * any connection (`isTransferSupported` inside `transferData`/
 * `getTransferPlan`), so an unsupported dialect (sqlite, excluded from
 * `TRANSFER_SUPPORTED_DIALECTS`) proves the throw without a live DB.
 * `dt.exportTable`/`dt.importFile` require a connection before reaching
 * the core tuple, so `connection: null` (NotConnectedError, from CP1) is
 * the achievable unit-level proof there.
 */
import { describe, it, expect } from 'bun:test';

import { TransferNamespace } from '../../src/sdk/namespaces/transfer.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { NotConnectedError } from '../../src/sdk/guards.js';
import { attachPolicyContext } from '../../src/core/policy/index.js';

import type { ContextState } from '../../src/sdk/state.js';
import { loadedStateManager } from '../utils/state-manager.js';
import type { Config } from '../../src/core/config/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures — mirrors tests/sdk/destructive-ops.test.ts
// ─────────────────────────────────────────────────────────────

function makeConfig(dialect: Config['connection']['dialect']): Config {

    return {
        name: 'dev',
        type: 'local',
        isTest: false,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect, database: 'testdb' },
    };

}

const stateManager = await loadedStateManager();

function makeState(config: Config): ContextState {

    attachPolicyContext(config.access, {});

    return {
        connection: null,
        config,
        settings: {},
        identity: {
            name: 'tester',
            source: 'system',
        },
        options: {},
        projectRoot: '/tmp',
        stateManager,
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: TransferNamespace/DtNamespace throw-not-tuple contract', () => {

    it('enforces project overrides and protected ceilings on raw destinations for plan and execution', async () => {

        const state = makeState(makeConfig('sqlite'));
        state.settings = {
            access: { roles: { admin: { permissions: { 'db:reset': 'deny', 'transfer:plan': 'deny' } } } },
            stages: { production: { defaults: { protected: true } } },
        } as ContextState['settings'];
        const transfer = new TransferNamespace(state);
        const destination = { ...makeConfig('sqlite'), name: 'production' };

        await expect(transfer.to(destination)).rejects.toThrow(/db:reset.*not allowed/);
        await expect(transfer.plan(destination)).rejects.toThrow(/transfer:plan/);

        state.settings = { stages: { production: { defaults: { protected: true } } } } as ContextState['settings'];
        state.options = { channel: 'agent' };
        await expect(transfer.to(destination)).rejects.toThrow(/db:reset.*not allowed/);
        await expect(transfer.plan(destination)).rejects.toThrow(/transfer:plan.*not allowed/);

    });

    it('resolves permitted destination policy without mutating caller access', async () => {

        const state = makeState(makeConfig('sqlite'));
        const transfer = new TransferNamespace(state);
        const destination = makeConfig('sqlite');

        await expect(transfer.to(destination)).rejects.toThrow(/Transfer not supported for dialect: sqlite/);
        await expect(transfer.plan(destination)).rejects.toThrow(/Transfer not supported for dialect: sqlite/);
        expect(Object.getOwnPropertySymbols(destination.access)).toHaveLength(0);

    });

    it('rejects unknown destination roles before planning or execution', async () => {

        const transfer = new TransferNamespace(makeState(makeConfig('sqlite')));
        const destination = { ...makeConfig('sqlite'), access: { user: 'missing', agent: 'missing' } };

        await expect(transfer.to(destination)).rejects.toThrow('Unknown access role "missing"');
        await expect(transfer.plan(destination)).rejects.toThrow('Unknown access role "missing"');

    });

    describe('TransferNamespace.to on an unsupported dialect', () => {

        it('should throw rather than resolve a [result, error] tuple', async () => {

            const sourceConfig = makeConfig('sqlite');
            const transfer = new TransferNamespace(makeState(sourceConfig));
            const destConfig = makeConfig('sqlite');

            await expect(transfer.to(destConfig)).rejects.toThrow(
                /Transfer not supported for dialect: sqlite/,
            );

        });

    });

    describe('TransferNamespace.plan on an unsupported dialect', () => {

        it('should throw rather than resolve a [plan, error] tuple', async () => {

            const sourceConfig = makeConfig('sqlite');
            const transfer = new TransferNamespace(makeState(sourceConfig));
            const destConfig = makeConfig('sqlite');

            await expect(transfer.plan(destConfig)).rejects.toThrow(
                /Transfer not supported for dialect: sqlite/,
            );

        });

    });

    describe('DtNamespace.exportTable with no connection', () => {

        it('should throw NotConnectedError rather than resolve a [result, error] tuple', async () => {

            const dt = new DtNamespace(makeState(makeConfig('postgres')));

            await expect(dt.exportTable('users', './fake.dtz')).rejects.toThrow(NotConnectedError);

        });

    });

    describe('DtNamespace.importFile with no connection', () => {

        it('should throw NotConnectedError rather than resolve a [result, error] tuple', async () => {

            const dt = new DtNamespace(makeState(makeConfig('postgres')));

            const err = await dt.importFile('./fake.dtz').catch((e: unknown) => e);

            expect(err).toBeInstanceOf(NotConnectedError);

        });

    });

});

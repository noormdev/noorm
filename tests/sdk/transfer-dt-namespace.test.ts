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

import type { ContextState } from '../../src/sdk/state.js';
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

function makeState(config: Config): ContextState {

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
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: TransferNamespace/DtNamespace throw-not-tuple contract', () => {

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

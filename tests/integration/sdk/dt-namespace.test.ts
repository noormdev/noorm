/**
 * Integration tests for DtNamespace against live postgres/mysql/mssql —
 * proves the tuple-to-throw contract (v1-25) holds against real
 * infrastructure, not the mocked/sqlite harness
 * `tests/sdk/transfer-dt-namespace.test.ts` already covers.
 *
 * `DtNamespace` has a `#kysely` getter guarded by `requireConnection`, so
 * (a) proves `NotConnectedError` without needing a live DB call at all —
 * kept inside the dialect block (still gated by `skipIfNoContainer`) for
 * parity with the sibling files.
 *
 * (b) does NOT use a nonexistent table name — verified live (all three
 * dialects) that `buildDtSchema`'s column lookup is an
 * `information_schema`/`sys.columns` query, which returns an empty result
 * set (not a SQL error) for a table that doesn't exist. `coreExportTable`
 * then proceeds past the schema-build step with a 0-column schema straight
 * into the worker pipeline (`WorkerPool`/`WorkerBridge` spin-up), which is
 * exactly the slow/flaky path this checkpoint must avoid. Instead, (b)
 * mirrors the spec's Isolation rule and `vault-namespace.test.ts`'s case
 * (c): a dedicated `createTestConnection(dialect)` destroyed before the
 * call, so `buildDtSchema`'s own queries fail immediately ("driver has
 * already been destroyed") — genuinely fails in `buildDtSchema`, before any
 * worker thread spins up, and doesn't touch the shared `beforeAll`
 * connection other tests in this file depend on.
 *
 * (c) uses a `.dt` (not `.dtz`) nonexistent path. `.dtz` goes through
 * `DtReader`'s gzip branch (`fileStream.pipe(gunzip)`), and `.pipe()` does
 * not forward the source stream's `'error'` event to the destination — with
 * no listener on `fileStream` itself, an ENOENT on a `.dtz` path becomes an
 * unhandled stream error that hangs the process instead of rejecting
 * `reader.open()`'s promise (verified live). `.dt` uses the raw stream
 * directly as readline's `input`, which does propagate stream errors into
 * the async iteration, so it rejects cleanly and fast, before worker
 * spin-up. Filed as a follow-up, not fixed here (test-only ticket).
 *
 * No happy-path export/import here — ticket 25's contract table already
 * unit-proves the shape; this file's job is only the real-failure throw
 * proof `ctx.noorm.dt.*` currently lacks live.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { DtNamespace } from '../../../src/sdk/namespaces/dt.js';
import { NotConnectedError } from '../../../src/sdk/guards.js';
import {
    createTestConnection,
    skipIfNoContainer,
    makeTestConfig,
    TEST_CONNECTIONS,
} from '../../utils/db.js';

import type { ContextState } from '../../../src/sdk/state.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConnectionResult, Dialect } from '../../../src/core/connection/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeState(connection: ConnectionResult | null, config: Config): ContextState {

    return {
        connection,
        config,
        settings: {},
        identity: { name: 'tester', source: 'system' },
        options: {},
        projectRoot: '/tmp',
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Suite factory — identical behavior across dialects, only the
// connection/config differ, so one factory generates all three
// `describe` blocks instead of tripling the test bodies.
// ─────────────────────────────────────────────────────────────

function describeDtNamespace(dialect: Dialect): void {

    describe(`sdk: DtNamespace live throw contract (${dialect})`, () => {

        let conn: ConnectionResult;
        let config: Config;

        beforeAll(async () => {

            await skipIfNoContainer(dialect);
            conn = await createTestConnection(dialect);
            config = makeTestConfig(`dt-ns-${dialect}`, TEST_CONNECTIONS[dialect]);

        });

        afterAll(async () => {

            if (conn) await conn.destroy();

        });

        it('(a) dt.exportTable() and dt.importFile() reject NotConnectedError when there is no connection', async () => {

            const dt = new DtNamespace(makeState(null, config));

            await expect(dt.exportTable('users', './fake.dtz')).rejects.toThrow(NotConnectedError);
            await expect(dt.importFile('./fake.dtz')).rejects.toThrow(NotConnectedError);

        });

        it('(b) dt.exportTable() rejects a generic Error on a real infra failure (dedicated connection destroyed before the call)', async () => {

            const dedicated = await createTestConnection(dialect);
            const dt = new DtNamespace(makeState(dedicated, config));
            await dedicated.destroy();

            const err = await dt.exportTable('nonexistent_table_xyz', './fake-export.dtz').catch((e: unknown) => e);

            expect(err).toBeInstanceOf(Error);
            expect(err).not.toBeInstanceOf(NotConnectedError);

        });

        it('(c) dt.importFile() rejects a generic Error for a genuinely absent file (fails in DtReader.open(), before worker spin-up)', async () => {

            const dt = new DtNamespace(makeState(conn, config));

            await expect(dt.importFile('/nonexistent-dir-noorm-test/x.dt')).rejects.toThrow();

        });

    });

}

describeDtNamespace('postgres');
describeDtNamespace('mysql');
describeDtNamespace('mssql');

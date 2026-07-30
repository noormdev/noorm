/**
 * SDK destructive-ops guard tests.
 *
 * Proves that role-denied configs (viewer/operator) unconditionally block
 * every destructive operation across DbNamespace, DtNamespace,
 * ChangesNamespace, RunNamespace, and TransferNamespace via checkPolicy,
 * and that admin-role configs proceed frictionlessly — change:revert
 * (`change:revert`), change:run/change:ff (`change:run`/`change:ff`),
 * run.file/run.build (`run:file`/`run:build`), transfer.to (`db:reset`
 * against the *destination* config), and
 * truncate/teardown/reset/importFile (`db:reset`) are all `allow` cells for
 * admin, matching the legacy protected:false behavior for open configs.
 * Read-only ops are never blocked regardless of access.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import { RunNamespace } from '../../src/sdk/namespaces/run.js';
import { TransferNamespace } from '../../src/sdk/namespaces/transfer.js';
import { ProtectedConfigError } from '../../src/sdk/guards.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { ConfigAccess } from '../../src/core/policy/index.js';
import type { Change } from '../../src/core/change/index.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

/** Mirrors the legacy `protected: true` migration mapping. */
const OPERATOR_ACCESS: ConfigAccess = { user: 'operator', agent: 'viewer' };

/** Denies everything but explore/sql:read on the user channel. */
const VIEWER_ACCESS: ConfigAccess = { user: 'viewer', agent: false };

/** Mirrors the legacy `protected: false` migration mapping. */
const ADMIN_ACCESS: ConfigAccess = { user: 'admin', agent: 'admin' };

function makeConfig(access: ConfigAccess): Config {

    return {
        name: access.user === 'admin' ? 'dev' : 'prod',
        type: 'local',
        isTest: false,
        access,
        connection: { dialect: 'postgres', database: 'testdb' },
    };

}

function makeState(access: ConfigAccess, options: ContextState['options'] = {}): ContextState {

    return {
        connection: null,
        config: makeConfig(access),
        settings: {},
        identity: {
            name: 'tester',
            source: 'system',
        },
        options,
        projectRoot: '/tmp',
        changeManager: null,
    };

}

/**
 * Fake Change fixture for delete() gate tests. rm({ force: true }) on a
 * nonexistent path silently no-ops, so a placeholder path is safe for every
 * test except the dedicated disk-mutation block below.
 */
function makeFakeChange(changePath: string = join(tmpdir(), 'sample-change')): Change {

    return {
        name: 'sample-change',
        path: changePath,
        date: new Date(),
        description: 'sample-change',
        changeFiles: [],
        revertFiles: [],
        hasChangelog: false,
    };

}

const tempDirs: string[] = [];

afterEach(async () => {

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));

});

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: access-guarded destructive ops', () => {

    // ─────────────────────────────────────────────────────
    // DbNamespace — operator role can't satisfy the db:reset
    // confirm cell (SDK has no interactive prompt)
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for truncate()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS));

            await expect(db.truncate()).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for teardown()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS));

            await expect(db.teardown()).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for reset()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS));

            await expect(db.reset()).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // DbNamespace — options.yes: true (context created with the
    // programmatic --yes equivalent) satisfies the db:reset confirm
    // cell for operator role without NOORM_YES in the environment
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on operator-role config with options.yes: true', () => {

        it('should not throw ProtectedConfigError for truncate()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS, { yes: true }));
            const err = await db.truncate().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

        it('should still throw ProtectedConfigError for teardown(), which stops below admin', async () => {

            // teardown consults `db:teardown`, not `db:reset`. That cell is
            // `deny` for operator, and a denial is not something `yes` can
            // satisfy — only a confirm cell is.
            const db = new DbNamespace(makeState(OPERATOR_ACCESS, { yes: true }));

            await expect(db.teardown()).rejects.toThrow(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError for reset()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS, { yes: true }));
            const err = await db.reset().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // DtNamespace — operator role can't satisfy the db:reset
    // confirm cell (SDK has no interactive prompt)
    // ─────────────────────────────────────────────────────

    describe('DtNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for importFile()', async () => {

            const dt = new DtNamespace(makeState(OPERATOR_ACCESS));

            await expect(dt.importFile('./fake.dtz')).rejects.toThrow(ProtectedConfigError);

        });

        it('should name the "dt.importFile" method the consumer called, not an internal alias', async () => {

            const dt = new DtNamespace(makeState(OPERATOR_ACCESS));

            expect.assertions(1);

            const err = await dt.importFile('./fake.dtz').catch((e: unknown) => e);

            if (err instanceof ProtectedConfigError) {

                expect(err.operation).toBe('dt.importFile');

            }

        });

    });

    // ─────────────────────────────────────────────────────
    // ChangesNamespace — operator role requires confirmation,
    // which the SDK cannot satisfy without NOORM_YES
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for revert()', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.revert('any-change')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for rewind()', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.rewind('any-change')).rejects.toThrow(ProtectedConfigError);

        });

        it('should name the "changes.rewind" method the consumer called, not "changes.revert"', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            expect.assertions(1);

            const err = await changes.rewind('any-change').catch((e: unknown) => e);

            if (err instanceof ProtectedConfigError) {

                expect(err.operation).toBe('changes.rewind');

            }

        });

    });

    // ─────────────────────────────────────────────────────
    // Admin role — change:revert is a frictionless `allow` cell,
    // matching the legacy protected:false behavior exactly
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace on admin-role config', () => {

        it('should not throw ProtectedConfigError for revert()', async () => {

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS));

            const err = await changes.revert('any-change').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Admin role — db:reset is an `allow` cell for admin, so
    // truncate/teardown/reset/importFile proceed frictionlessly,
    // same as the legacy protected:false behavior
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on admin-role config', () => {

        it('should throw ProtectedConfigError for an unconfirmed truncate()', async () => {

            // The defect this encodes: truncate used to consult `db:reset`,
            // which is `allow` for admin, so the default config wiped every
            // table with nothing asked of it. `db:truncate` is `confirm`.
            const db = new DbNamespace(makeState(ADMIN_ACCESS));

            await expect(db.truncate()).rejects.toThrow(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError for a pre-confirmed truncate()', async () => {

            const db = new DbNamespace(makeState(ADMIN_ACCESS, { yes: true }));
            const err = await db.truncate().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('DtNamespace on admin-role config', () => {

        it('should not throw ProtectedConfigError for importFile()', async () => {

            const dt = new DtNamespace(makeState(ADMIN_ACCESS));
            const err = await dt.importFile('./fake.dtz').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Read-only ops — never blocked regardless of access
    // ─────────────────────────────────────────────────────

    describe('DtNamespace read-only ops on operator-role config', () => {

        it('should not throw ProtectedConfigError for exportTable()', async () => {

            const dt = new DtNamespace(makeState(OPERATOR_ACCESS));

            const err = await dt.exportTable('users', './fake.dtz').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // RunNamespace — viewer denies run:file/run:build outright;
    // operator requires confirmation the SDK cannot give
    // ─────────────────────────────────────────────────────

    describe('RunNamespace on viewer-role config', () => {

        it('should throw ProtectedConfigError for file()', async () => {

            const run = new RunNamespace(makeState(VIEWER_ACCESS));

            await expect(run.file('sql/seed.sql')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for build()', async () => {

            const run = new RunNamespace(makeState(VIEWER_ACCESS));

            await expect(run.build()).rejects.toThrow(ProtectedConfigError);

        });

    });

    describe('RunNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for file() when NOORM_YES is unset', async () => {

            const run = new RunNamespace(makeState(OPERATOR_ACCESS));

            await expect(run.file('sql/seed.sql')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for build() when NOORM_YES is unset', async () => {

            const run = new RunNamespace(makeState(OPERATOR_ACCESS));

            await expect(run.build()).rejects.toThrow(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError for file() once NOORM_YES=1 is set', async () => {

            process.env['NOORM_YES'] = '1';

            const run = new RunNamespace(makeState(OPERATOR_ACCESS));
            const err = await run.file('sql/seed.sql').catch((e: unknown) => e);

            delete process.env['NOORM_YES'];

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('RunNamespace on admin-role config', () => {

        it('should not throw ProtectedConfigError for file()', async () => {

            const run = new RunNamespace(makeState(ADMIN_ACCESS));
            const err = await run.file('sql/seed.sql').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError for build()', async () => {

            const run = new RunNamespace(makeState(ADMIN_ACCESS));
            const err = await run.build().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // ChangesNamespace — viewer denies change:run/change:ff outright;
    // operator requires confirmation the SDK cannot give
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace apply/ff on viewer-role config', () => {

        it('should throw ProtectedConfigError for apply()', async () => {

            const changes = new ChangesNamespace(makeState(VIEWER_ACCESS));

            await expect(changes.apply('any-change')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for ff()', async () => {

            const changes = new ChangesNamespace(makeState(VIEWER_ACCESS));

            await expect(changes.ff()).rejects.toThrow(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace apply/ff on operator-role config', () => {

        it('should throw ProtectedConfigError for apply() when NOORM_YES is unset', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.apply('any-change')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for ff() when NOORM_YES is unset', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.ff()).rejects.toThrow(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError for apply() once NOORM_YES=1 is set', async () => {

            process.env['NOORM_YES'] = '1';

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));
            const err = await changes.apply('any-change').catch((e: unknown) => e);

            delete process.env['NOORM_YES'];

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace apply/ff on admin-role config', () => {

        it('should not throw ProtectedConfigError for apply()', async () => {

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS));
            const err = await changes.apply('any-change').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError for ff()', async () => {

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS));
            const err = await changes.ff().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // ChangesNamespace.delete() — deleting an applied change also
    // deletes its DB tracking row, so admin gets `confirm` here
    // (like config:rm/db:destroy), NOT the frictionless `allow`
    // change:revert gives admin.
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace delete() on viewer-role config', () => {

        it('should throw ProtectedConfigError', async () => {

            const changes = new ChangesNamespace(makeState(VIEWER_ACCESS));

            await expect(changes.delete(makeFakeChange())).rejects.toThrow(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace delete() on operator-role config', () => {

        it('should throw ProtectedConfigError', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.delete(makeFakeChange())).rejects.toThrow(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace delete() on operator-role config with options.yes: true', () => {

        it('should not throw ProtectedConfigError', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS, { yes: true }));
            const err = await changes.delete(makeFakeChange()).catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace delete() on admin-role config', () => {

        // Unlike change:revert (an `allow` cell for admin), change:rm stays
        // `confirm` for admin too — deletion is irreversible and can drop
        // the DB tracking row, so even admin needs options.yes.
        it('should throw ProtectedConfigError', async () => {

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS));

            await expect(changes.delete(makeFakeChange())).rejects.toThrow(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace delete() on admin-role config with options.yes: true', () => {

        it('should not throw ProtectedConfigError', async () => {

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS, { yes: true }));
            const err = await changes.delete(makeFakeChange()).catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // ChangesNamespace.delete() — disk-state proof: a denied call
    // never touches the filesystem, an allowed call actually
    // removes the change directory
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace delete() disk mutation', () => {

        it('should leave the change directory intact when denied', async () => {

            const dir = await mkdtemp(join(tmpdir(), 'noorm-change-rm-denied-'));
            tempDirs.push(dir);

            const changes = new ChangesNamespace(makeState(VIEWER_ACCESS));

            await expect(changes.delete(makeFakeChange(dir))).rejects.toThrow(ProtectedConfigError);
            expect(existsSync(dir)).toBe(true);

        });

        it('should remove the change directory when admin confirms with options.yes: true', async () => {

            const dir = await mkdtemp(join(tmpdir(), 'noorm-change-rm-allowed-'));
            tempDirs.push(dir);

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS, { yes: true }));

            await changes.delete(makeFakeChange(dir));
            expect(existsSync(dir)).toBe(false);

        });

    });

    // ─────────────────────────────────────────────────────
    // TransferNamespace — gated on the DESTINATION config's role, since
    // the destructive act (writing rows) lands there, not on the source
    // ─────────────────────────────────────────────────────

    describe('TransferNamespace transfer.to on a viewer-role destination', () => {

        it('should throw ProtectedConfigError even when the source config is admin', async () => {

            const transfer = new TransferNamespace(makeState(ADMIN_ACCESS));
            const destConfig = makeConfig(VIEWER_ACCESS);

            await expect(transfer.to(destConfig)).rejects.toThrow(ProtectedConfigError);

        });

    });

    describe('TransferNamespace transfer.to on an operator-role destination', () => {

        it('should throw ProtectedConfigError when NOORM_YES is unset', async () => {

            const transfer = new TransferNamespace(makeState(ADMIN_ACCESS));
            const destConfig = makeConfig(OPERATOR_ACCESS);

            await expect(transfer.to(destConfig)).rejects.toThrow(ProtectedConfigError);

        });

        it('should not throw ProtectedConfigError once NOORM_YES=1 is set', async () => {

            process.env['NOORM_YES'] = '1';

            const transfer = new TransferNamespace(makeState(ADMIN_ACCESS));
            const destConfig = makeConfig(OPERATOR_ACCESS);
            const err = await transfer.to(destConfig).catch((e: unknown) => e);

            delete process.env['NOORM_YES'];

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('TransferNamespace transfer.to on an admin-role destination', () => {

        it('should not throw ProtectedConfigError', async () => {

            const transfer = new TransferNamespace(makeState(ADMIN_ACCESS));
            const destConfig = makeConfig(ADMIN_ACCESS);
            const err = await transfer.to(destConfig).catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

});

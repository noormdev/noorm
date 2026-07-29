/**
 * The access a config gets when it never declared one.
 *
 * A stock noorm project writes no `access`, so this default is what an MCP
 * agent actually holds against every config in the wild. It used to be
 * admin on both channels, which left every other gate in the matrix
 * decorative on the agent channel. These tests drive the real parse path and
 * the real matrix rather than comparing constants, so a regression surfaces
 * as "an agent can drop the database" instead of "a literal changed".
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { parseConfig } from '../../../src/core/config/index.js';
import { checkPolicy } from '../../../src/core/policy/index.js';
import type { ConfigAccess, Permission } from '../../../src/core/policy/index.js';
import { migrateState } from '../../../src/core/version/state/index.js';

/** A config exactly as it lands on disk before anyone edits access: no `access` key. */
function stockConfigInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {

    return {
        name: 'stock',
        type: 'local',
        isTest: true,
        connection: { dialect: 'sqlite', database: ':memory:' },
        ...overrides,
    };

}

function stockAccess(overrides: Record<string, unknown> = {}): ConfigAccess {

    return parseConfig(stockConfigInput(overrides)).access;

}

/** Permissions that let an agent change data, schema, or the database itself. */
const MUTATING: Permission[] = [
    'sql:write',
    'sql:ddl',
    'db:create',
    'db:destroy',
    'run:build',
];

/** Permissions the agent channel exists to serve — read-only inspection. */
const READ_ONLY: Permission[] = [
    'explore',
    'sql:read',
];

describe('policy: default access', () => {

    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {

        envBackup['NOORM_YES'] = process.env['NOORM_YES'];
        delete process.env['NOORM_YES'];

    });

    afterEach(() => {

        if (envBackup['NOORM_YES'] === undefined) {

            delete process.env['NOORM_YES'];

        }
        else {

            process.env['NOORM_YES'] = envBackup['NOORM_YES'];

        }

    });

    describe('mcp channel', () => {

        for (const permission of MUTATING) {

            it(`should deny "${permission}" on a config that never declared access`, () => {

                const check = checkPolicy('mcp', { name: 'stock', access: stockAccess() }, permission);

                expect(check.allowed).toBe(false);

            });

        }

        for (const permission of READ_ONLY) {

            it(`should still allow "${permission}" on a config that never declared access`, () => {

                const check = checkPolicy('mcp', { name: 'stock', access: stockAccess() }, permission);

                expect(check.allowed).toBe(true);

            });

        }

        it('should not hand the agent channel stored credentials', () => {

            const target = { name: 'stock', access: stockAccess() };

            expect(checkPolicy('mcp', target, 'vault:read').allowed).toBe(false);
            expect(checkPolicy('mcp', target, 'secret:read').allowed).toBe(false);

        });

        it('should leave the config visible — restricted, not hidden', () => {

            // `mcp: false` would make the config unreachable and report the
            // same error as an unknown config, giving an operator no way to
            // tell a downgraded default from a typo. The default restricts
            // the role instead.
            expect(stockAccess().mcp).not.toBe(false);

        });

    });

    describe('user channel', () => {

        it('should keep admin on a config that never declared access', () => {

            expect(stockAccess().user).toBe('admin');

        });

        for (const permission of [...MUTATING, ...READ_ONLY]) {

            it(`should still allow "${permission}" for the human operator`, () => {

                const check = checkPolicy('user', { name: 'stock', access: stockAccess() }, permission);

                expect(check.allowed).toBe(true);

            });

        }

    });

    describe('explicit access', () => {

        it('should preserve an explicit mcp:admin opt-in verbatim', () => {

            const access = stockAccess({ access: { user: 'operator', mcp: 'admin' } });

            expect(access).toEqual({ user: 'operator', mcp: 'admin' });
            expect(checkPolicy('mcp', { name: 'stock', access }, 'sql:write').allowed).toBe(true);

        });

        it('should preserve an explicit restriction verbatim', () => {

            expect(stockAccess({ access: { user: 'viewer', mcp: false } }))
                .toEqual({ user: 'viewer', mcp: false });

        });

        it('should not let the legacy protected flag re-open the agent channel', () => {

            // `protected: false` said "the author asked for no restriction",
            // which is the default case — not an explicit grant of admin.
            expect(stockAccess({ protected: false }).mcp).not.toBe('admin');

        });

    });

    describe('state migration', () => {

        it('should not backfill mcp:admin onto a legacy unprotected config', () => {

            const migrated = migrateState({
                configs: { dev: { name: 'dev', protected: false } },
            });

            const configs = migrated['configs'] as Record<string, { access: ConfigAccess }>;

            expect(configs['dev']!.access.mcp).not.toBe('admin');
            expect(configs['dev']!.access.user).toBe('admin');

        });

        it('should leave a config that already stored an explicit access alone', () => {

            const migrated = migrateState({
                configs: { dev: { name: 'dev', access: { user: 'operator', mcp: 'admin' } } },
            });

            const configs = migrated['configs'] as Record<string, { access: ConfigAccess }>;

            expect(configs['dev']!.access).toEqual({ user: 'operator', mcp: 'admin' });

        });

    });

});

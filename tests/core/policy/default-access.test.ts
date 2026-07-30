/**
 * The access a config gets when it never declared one.
 *
 * A stock noorm project writes no `access`, so this default is what any
 * agent actually holds against every config in the wild — over MCP and, now,
 * when it shells out to the CLI. It used to be admin on both channels, which
 * left every other gate in the matrix decorative on the agent channel. These
 * tests drive the real parse path and the real matrix rather than comparing
 * constants, so a regression surfaces as "an agent can drop the database"
 * instead of "a literal changed".
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

    describe('agent channel', () => {

        for (const permission of MUTATING) {

            it(`should deny "${permission}" on a config that never declared access`, () => {

                const check = checkPolicy('agent', { name: 'stock', access: stockAccess() }, permission);

                expect(check.allowed).toBe(false);

            });

        }

        for (const permission of READ_ONLY) {

            it(`should still allow "${permission}" on a config that never declared access`, () => {

                const check = checkPolicy('agent', { name: 'stock', access: stockAccess() }, permission);

                expect(check.allowed).toBe(true);

            });

        }

        it('should not hand the agent channel stored credentials', () => {

            const target = { name: 'stock', access: stockAccess() };

            expect(checkPolicy('agent', target, 'vault:read').allowed).toBe(false);
            expect(checkPolicy('agent', target, 'secret:read').allowed).toBe(false);

        });

        it('should leave the config visible — restricted, not hidden', () => {

            // `agent: false` would make the config unreachable and report the
            // same error as an unknown config, giving an operator no way to
            // tell a downgraded default from a typo. The default restricts
            // the role instead.
            expect(stockAccess().agent).not.toBe(false);

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

        it('should preserve an explicit agent:admin opt-in verbatim', () => {

            const access = stockAccess({ access: { user: 'operator', agent: 'admin' } });

            expect(access).toEqual({ user: 'operator', agent: 'admin' });
            expect(checkPolicy('agent', { name: 'stock', access }, 'sql:write').allowed).toBe(true);

        });

        it('should preserve an explicit restriction verbatim', () => {

            expect(stockAccess({ access: { user: 'viewer', agent: false } }))
                .toEqual({ user: 'viewer', agent: false });

        });

        it('should not let the legacy protected flag re-open the agent channel', () => {

            // `protected: false` said "the author asked for no restriction",
            // which is the default case — not an explicit grant of admin.
            expect(stockAccess({ protected: false }).agent).not.toBe('admin');

        });

    });

    describe('state migration', () => {

        it('should not backfill agent:admin onto a legacy unprotected config', () => {

            const migrated = migrateState({
                configs: { dev: { name: 'dev', protected: false } },
            });

            const configs = migrated['configs'] as Record<string, { access: ConfigAccess }>;

            expect(configs['dev']!.access.agent).not.toBe('admin');
            expect(configs['dev']!.access.user).toBe('admin');

        });

        it('should leave a config that already stored an explicit access alone', () => {

            const migrated = migrateState({
                configs: { dev: { name: 'dev', access: { user: 'operator', agent: 'admin' } } },
            });

            const configs = migrated['configs'] as Record<string, { access: ConfigAccess }>;

            expect(configs['dev']!.access).toEqual({ user: 'operator', agent: 'admin' });

        });

    });

});

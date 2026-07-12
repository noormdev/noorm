import { describe, it, expect } from 'bun:test';
import { attemptSync } from '@logosdx/utils';
import {
    checkRequireTest,
    checkProtectedConfig,
    RequireTestError,
    ProtectedConfigError,
} from '../../src/sdk/guards.js';
import type { Config } from '../../src/core/config/types.js';
import type { ConfigAccess } from '../../src/core/policy/index.js';
import type { CreateContextOptions } from '../../src/sdk/types.js';

const ADMIN_ACCESS: ConfigAccess = { user: 'admin', mcp: 'admin' };
const OPERATOR_ACCESS: ConfigAccess = { user: 'operator', mcp: 'viewer' };
const VIEWER_ACCESS: ConfigAccess = { user: 'viewer', mcp: false };

function makeConfig(access: ConfigAccess, overrides: Partial<Config> = {}): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access,
        connection: { dialect: 'postgres', database: 'testdb' },
        ...overrides,
    };

}

describe('checkRequireTest', () => {

    it('does not throw when requireTest is false and isTest is false', () => {

        const config = makeConfig(ADMIN_ACCESS, { isTest: false });
        const options: CreateContextOptions = { requireTest: false };

        expect(() => checkRequireTest(config, options)).not.toThrow();

    });

    it('does not throw when requireTest is true and isTest is true', () => {

        const config = makeConfig(ADMIN_ACCESS, { isTest: true });
        const options: CreateContextOptions = { requireTest: true };

        expect(() => checkRequireTest(config, options)).not.toThrow();

    });

    it('throws RequireTestError when requireTest is true and isTest is false', () => {

        const config = makeConfig(ADMIN_ACCESS, { isTest: false, name: 'prod' });
        const options: CreateContextOptions = { requireTest: true };

        expect(() => checkRequireTest(config, options)).toThrow(RequireTestError);

    });

    it('carries config name in RequireTestError', () => {

        const config = makeConfig(ADMIN_ACCESS, { isTest: false, name: 'prod' });
        const options: CreateContextOptions = { requireTest: true };

        expect.assertions(2);

        const [, err] = attemptSync(() => checkRequireTest(config, options));

        if (err instanceof RequireTestError) {

            expect(err.configName).toBe('prod');
            expect(err.message).toContain('prod');

        }

    });

    it('does not throw when requireTest is omitted from options', () => {

        const config = makeConfig(ADMIN_ACCESS, { isTest: false });
        const options: CreateContextOptions = {};

        expect(() => checkRequireTest(config, options)).not.toThrow();

    });

});

describe('checkProtectedConfig', () => {

    it('does not throw when the permission is an allow cell for the role (change:revert, admin)', () => {

        const config = makeConfig(ADMIN_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'change:revert', 'changes.revert')).not.toThrow();

    });

    it('does not throw when the permission is an allow cell for the role (db:reset, admin)', () => {

        const config = makeConfig(ADMIN_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate')).not.toThrow();

    });

    it('throws ProtectedConfigError when the role denies the permission (db:reset, viewer)', () => {

        const config = makeConfig(VIEWER_ACCESS, { name: 'prod' });

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('surfaces the policy blockedReason (role + permission) on a deny cell', () => {

        const config = makeConfig(VIEWER_ACCESS, { name: 'prod' });

        expect.assertions(1);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate'));

        if (err instanceof ProtectedConfigError) {

            expect(err.message).toContain('"db:reset" is not allowed on config "prod" (role: viewer).');

        }

    });

    it('throws ProtectedConfigError when the role requires confirmation the SDK cannot give (db:reset, operator)', () => {

        const config = makeConfig(OPERATOR_ACCESS, { name: 'prod' });

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('carries configName in ProtectedConfigError', () => {

        const config = makeConfig(OPERATOR_ACCESS, { name: 'prod' });

        expect.assertions(1);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate'));

        if (err instanceof ProtectedConfigError) {

            expect(err.configName).toBe('prod');

        }

    });

    it('carries operation in ProtectedConfigError', () => {

        const config = makeConfig(OPERATOR_ACCESS, { name: 'prod' });

        expect.assertions(2);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate'));

        if (err instanceof ProtectedConfigError) {

            expect(err.operation).toBe('truncate');
            expect(err.message).toContain('truncate');

        }

    });

    it('blocks truncate-class operations (db:reset) for operator role', () => {

        const config = makeConfig(OPERATOR_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('blocks teardown-class operations (db:reset) for operator role', () => {

        const config = makeConfig(OPERATOR_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'teardown')).toThrow(ProtectedConfigError);

    });

    it('blocks reset-class operations (db:reset) for operator role', () => {

        const config = makeConfig(OPERATOR_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'reset')).toThrow(ProtectedConfigError);

    });

    it('blocks dt.import-class operations (db:reset) for operator role', () => {

        const config = makeConfig(OPERATOR_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'dt.import')).toThrow(ProtectedConfigError);

    });

    it('allows truncate/teardown/reset/dt.import-class operations (db:reset) for admin role without confirmation', () => {

        const config = makeConfig(ADMIN_ACCESS, { name: 'prod' });

        for (const operation of ['truncate', 'teardown', 'reset', 'dt.import']) {

            expect(() => checkProtectedConfig(config, {}, 'db:reset', operation)).not.toThrow();

        }

    });

    it('blocks changes.revert-class operations (change:revert) for viewer role', () => {

        const config = makeConfig(VIEWER_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'change:revert', 'changes.revert')).toThrow(ProtectedConfigError);

    });

    it('blocks a confirm cell for admin role (db:destroy, reserved for dropping a database) when NOORM_YES is unset', () => {

        const config = makeConfig(ADMIN_ACCESS, { name: 'prod' });

        expect(() => checkProtectedConfig(config, {}, 'db:destroy', 'drop')).toThrow(ProtectedConfigError);

    });

    it('names the confirmation route in the message when confirmation is required', () => {

        const config = makeConfig(ADMIN_ACCESS, { name: 'prod' });

        expect.assertions(1);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'db:destroy', 'drop'));

        if (err instanceof ProtectedConfigError) {

            expect(err.message).toContain('NOORM_YES');

        }

    });

    it('allows a confirm cell for admin role (db:destroy) once NOORM_YES=1 is set', () => {

        process.env['NOORM_YES'] = '1';

        const config = makeConfig(ADMIN_ACCESS);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'db:destroy', 'drop'));

        delete process.env['NOORM_YES'];

        expect(err).toBeNull();

    });

    it('blocks a confirm cell for operator role (change:revert) when NOORM_YES is unset', () => {

        const config = makeConfig(OPERATOR_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'change:revert', 'changes.revert')).toThrow(ProtectedConfigError);

    });

    it('allows a confirm cell for operator role (change:revert) once NOORM_YES=1 is set', () => {

        process.env['NOORM_YES'] = '1';

        const config = makeConfig(OPERATOR_ACCESS);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'change:revert', 'changes.revert'));

        delete process.env['NOORM_YES'];

        expect(err).toBeNull();

    });

    it('defaults the channel to user when options.channel is omitted', () => {

        // change:revert is a confirm cell for operator — allowed on `user`
        // once NOORM_YES skips the prompt, but OPERATOR_ACCESS.mcp is
        // 'viewer', a deny cell, so the `mcp` channel is always blocked.
        // (VIEWER_ACCESS.mcp === false would deny on both channels
        // regardless of the default, proving nothing about which one ran.)
        // If the default silently fell through to `mcp` this would throw,
        // so this pins the CreateContextOptions.channel default to `user`.
        process.env['NOORM_YES'] = '1';

        const config = makeConfig(OPERATOR_ACCESS);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'change:revert', 'changes.revert'));

        delete process.env['NOORM_YES'];

        expect(err).toBeNull();

    });

    it('respects an explicit mcp channel, where NOORM_YES has no effect on confirm cells', () => {

        process.env['NOORM_YES'] = '1';

        const config = makeConfig(ADMIN_ACCESS);

        expect(
            () => checkProtectedConfig(config, { channel: 'mcp' }, 'db:destroy', 'drop'),
        ).toThrow(ProtectedConfigError);

        delete process.env['NOORM_YES'];

    });

    it('throws ProtectedConfigError for operator role on db:reset when options.yes is absent and NOORM_YES is unset', () => {

        const config = makeConfig(OPERATOR_ACCESS, { name: 'prod' });

        expect(() => checkProtectedConfig(config, { channel: 'user' }, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('allows a confirm cell for operator role (db:reset) once options.yes is true, without NOORM_YES', () => {

        const config = makeConfig(OPERATOR_ACCESS, { name: 'prod' });

        const [, err] = attemptSync(() => checkProtectedConfig(config, { channel: 'user', yes: true }, 'db:reset', 'truncate'));

        expect(err).toBeNull();

    });

    it('denies db:reset on the mcp channel even when options.yes is true (operator config, mcp resolves to viewer -> deny)', () => {

        const config = makeConfig(OPERATOR_ACCESS, { name: 'prod' });

        expect(() => checkProtectedConfig(config, { channel: 'mcp', yes: true }, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('denies db:reset on the mcp channel via the confirm-to-deny collapse, even when options.yes is true (mcp:operator hits a confirm cell, not a plain deny)', () => {

        // mcp:'viewer' above hits db:reset's deny cell directly and never
        // reaches checkPolicy's mcp-collapse branch (check.ts ~68-75). Here
        // mcp:'operator' resolves db:reset to the same 'confirm' cell as the
        // user channel, so this only denies if the mcp channel collapses
        // confirm-to-deny before options.yes is ever consulted -- the
        // invariant spec C2 pins. If that collapse branch were removed,
        // options.yes: true would satisfy requiresConfirmation and this
        // would NOT throw.
        const config = makeConfig({ user: 'operator', mcp: 'operator' }, { name: 'prod' });

        expect(() => checkProtectedConfig(config, { channel: 'mcp', yes: true }, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('names --yes in the confirmation message alongside NOORM_YES=1', () => {

        const config = makeConfig(ADMIN_ACCESS, { name: 'prod' });

        expect.assertions(2);

        const [, err] = attemptSync(() => checkProtectedConfig(config, {}, 'db:destroy', 'drop'));

        if (err instanceof ProtectedConfigError) {

            expect(err.message).toContain('--yes');
            expect(err.message).toContain('NOORM_YES=1');

        }

    });

});

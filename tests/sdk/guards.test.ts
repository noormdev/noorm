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
        protected: access.user !== 'admin',
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

        // A viewer config denies db:reset on the `user` channel. If the
        // default silently fell through to some other channel this would
        // not throw, so this pins the CreateContextOptions.channel default.
        const config = makeConfig(VIEWER_ACCESS);

        expect(() => checkProtectedConfig(config, {}, 'db:reset', 'truncate')).toThrow(ProtectedConfigError);

    });

    it('respects an explicit mcp channel, where NOORM_YES has no effect on confirm cells', () => {

        process.env['NOORM_YES'] = '1';

        const config = makeConfig(ADMIN_ACCESS);

        expect(
            () => checkProtectedConfig(config, { channel: 'mcp' }, 'db:destroy', 'drop'),
        ).toThrow(ProtectedConfigError);

        delete process.env['NOORM_YES'];

    });

});

import { describe, it, expect } from 'bun:test';
import {
    checkRequireTest,
    checkProtectedConfig,
    RequireTestError,
    ProtectedConfigError,
} from '../../src/sdk/guards.js';
import type { Config } from '../../src/core/config/types.js';
import type { CreateContextOptions } from '../../src/sdk/types.js';

function makeConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        protected: false,
        connection: { dialect: 'postgres', database: 'testdb' },
        ...overrides,
    };

}

describe('checkRequireTest', () => {

    it('does not throw when requireTest is false and isTest is false', () => {

        const config = makeConfig({ isTest: false });
        const options: CreateContextOptions = { requireTest: false };

        expect(() => checkRequireTest(config, options)).not.toThrow();

    });

    it('does not throw when requireTest is true and isTest is true', () => {

        const config = makeConfig({ isTest: true });
        const options: CreateContextOptions = { requireTest: true };

        expect(() => checkRequireTest(config, options)).not.toThrow();

    });

    it('throws RequireTestError when requireTest is true and isTest is false', () => {

        const config = makeConfig({ isTest: false, name: 'prod' });
        const options: CreateContextOptions = { requireTest: true };

        expect(() => checkRequireTest(config, options)).toThrow(RequireTestError);

    });

    it('carries config name in RequireTestError', () => {

        const config = makeConfig({ isTest: false, name: 'prod' });
        const options: CreateContextOptions = { requireTest: true };

        expect.assertions(2);

        try {

            checkRequireTest(config, options);

        }
        catch (err) {

            if (err instanceof RequireTestError) {

                expect(err.configName).toBe('prod');
                expect(err.message).toContain('prod');

            }

        }

    });

    it('does not throw when requireTest is omitted from options', () => {

        const config = makeConfig({ isTest: false });
        const options: CreateContextOptions = {};

        expect(() => checkRequireTest(config, options)).not.toThrow();

    });

});

describe('checkProtectedConfig', () => {

    it('does not throw on non-protected config', () => {

        const config = makeConfig({ protected: false });
        const operation = 'truncate';

        expect(() => checkProtectedConfig(config, operation)).not.toThrow();

    });

    it('throws ProtectedConfigError when protected is true', () => {

        const config = makeConfig({ protected: true });
        const operation = 'truncate';

        expect(() => checkProtectedConfig(config, operation)).toThrow(ProtectedConfigError);

    });

    it('carries configName in ProtectedConfigError', () => {

        const config = makeConfig({ protected: true, name: 'prod' });
        const operation = 'truncate';

        expect.assertions(1);

        try {

            checkProtectedConfig(config, operation);

        }
        catch (err) {

            if (err instanceof ProtectedConfigError) {

                expect(err.configName).toBe('prod');

            }

        }

    });

    it('carries operation in ProtectedConfigError', () => {

        const config = makeConfig({ protected: true, name: 'prod' });
        const operation = 'truncate';

        expect.assertions(2);

        try {

            checkProtectedConfig(config, operation);

        }
        catch (err) {

            if (err instanceof ProtectedConfigError) {

                expect(err.operation).toBe('truncate');
                expect(err.message).toContain('truncate');

            }

        }

    });

    it('blocks truncate operation', () => {

        const config = makeConfig({ protected: true });

        expect(() => checkProtectedConfig(config, 'truncate')).toThrow(ProtectedConfigError);

    });

    it('blocks teardown operation', () => {

        const config = makeConfig({ protected: true });

        expect(() => checkProtectedConfig(config, 'teardown')).toThrow(ProtectedConfigError);

    });

    it('blocks reset operation', () => {

        const config = makeConfig({ protected: true });

        expect(() => checkProtectedConfig(config, 'reset')).toThrow(ProtectedConfigError);

    });

    it('blocks dt.import operation', () => {

        const config = makeConfig({ protected: true });

        expect(() => checkProtectedConfig(config, 'dt.import')).toThrow(ProtectedConfigError);

    });

    it('blocks changes.revert operation', () => {

        const config = makeConfig({ protected: true });

        expect(() => checkProtectedConfig(config, 'changes.revert')).toThrow(ProtectedConfigError);

    });

});

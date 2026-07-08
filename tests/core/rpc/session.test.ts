import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { SessionManager } from '../../../src/rpc/session.js';
import { configNotFoundMessage } from '../../../src/core/config/resolver.js';
import type { Config } from '../../../src/core/config/types.js';

// The real `createContext` resolves configs through on-disk state, which
// session.connect() would otherwise need a live project + identity key for.
// Mocking it lets these tests drive the mcp-channel invisibility and
// fail-closed rules directly, with a plain in-memory config registry.
const actualSdk = await import('../../../src/sdk/index.js');

/** Configs the mocked `createContext` resolves by name. */
const configs = new Map<string, Config>();

mock.module('../../../src/sdk/index.js', () => ({
    ...actualSdk,
    createContext: async ({ config }: { config?: string } = {}) => {

        const name = config ?? 'default';
        const found = configs.get(name);

        if (!found) {

            throw new Error(configNotFoundMessage(name));

        }

        return {
            dialect: found.connection.dialect,
            noorm: { config: found },
            connect: async () => {},
            disconnect: async () => {},
        };

    },
}));

function testConfig(name: string, overrides: Partial<Config> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:' },
        ...overrides,
    };

}

describe('rpc: session manager', () => {

    let session: SessionManager;

    beforeEach(() => {

        session = new SessionManager();
        configs.clear();

    });

    afterEach(() => {

        configs.clear();

    });

    afterAll(() => {

        mock.module('../../../src/sdk/index.js', () => actualSdk);

    });

    describe('getContext', () => {

        it('should throw when not connected', () => {

            expect(() => session.getContext('dev')).toThrow(/not connected/i);

        });

        it('should throw with config name in error', () => {

            expect(() => session.getContext('production')).toThrow(/production/);

        });

    });

    describe('hasConnection', () => {

        it('should return false when not connected', () => {

            expect(session.hasConnection('dev')).toBe(false);

        });

    });

    describe('listConnections', () => {

        it('should return empty array when no connections', () => {

            expect(session.listConnections()).toEqual([]);

        });

    });

    describe('channel', () => {

        it('should default to "user"', () => {

            expect(new SessionManager().channel).toBe('user');

        });

        it('should expose the channel passed to the constructor', () => {

            expect(new SessionManager('mcp').channel).toBe('mcp');

        });

    });

    describe('connect: mcp invisibility', () => {

        it('should throw the byte-identical error for a hidden config (access.mcp: false) and an unknown config', async () => {

            const mcpSession = new SessionManager('mcp');

            const [, unknownErr] = await attempt(() => mcpSession.connect('does-not-exist'));

            configs.set('secret', testConfig('secret', { access: { user: 'admin', mcp: false } }));

            const [, hiddenErr] = await attempt(() => mcpSession.connect('secret'));

            expect(unknownErr).toBeDefined();
            expect(hiddenErr).toBeDefined();
            expect(unknownErr!.message).toBe('Failed to create context: Config "does-not-exist" not found');
            expect(hiddenErr!.message).toBe(unknownErr!.message.replace('does-not-exist', 'secret'));

        });

        it('should allow a visible config through on the mcp channel and report its mcp role', async () => {

            const mcpSession = new SessionManager('mcp');

            configs.set('reporting', testConfig('reporting', { access: { user: 'admin', mcp: 'viewer' } }));

            const info = await mcpSession.connect('reporting');

            expect(info.role).toBe('viewer');

        });

        it('should not apply mcp invisibility on the user channel', async () => {

            configs.set('secret', testConfig('secret', { access: { user: 'operator', mcp: false } }));

            const info = await session.connect('secret');

            expect(info.role).toBe('operator');

        });

        it('should deny an mcp-channel config that reaches connect with no `access` at all, identically to an unknown config', async () => {

            const mcpSession = new SessionManager('mcp');

            const [, unknownErr] = await attempt(() => mcpSession.connect('does-not-exist'));

            // `Config.access` is required at compile time; this hand-built
            // double simulates a runtime boundary that bypasses it (a
            // non-TS SDK caller, or state that slipped past the load-time
            // normalization) to prove the `!rawAccess` fail-closed check in
            // session.ts actually denies rather than throwing or opening up.
            const noAccessConfig = testConfig('no-access');
            Reflect.deleteProperty(noAccessConfig, 'access');
            configs.set('no-access', noAccessConfig);

            const [, noAccessErr] = await attempt(() => mcpSession.connect('no-access'));

            expect(unknownErr).toBeDefined();
            expect(noAccessErr).toBeDefined();
            expect(noAccessErr!.message).toBe(unknownErr!.message.replace('does-not-exist', 'no-access'));

        });

    });

});

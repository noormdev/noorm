/**
 * SDK createContext lifecycle tests.
 *
 * Tests factory behavior and pre-connect guards.
 * No ctx.connect() calls — no real DB required.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { createContext, RequireTestError } from '../../src/sdk/index.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Set env vars for env-only mode and return a cleanup function.
 *
 * NOORM_CONNECTION_DIALECT + NOORM_CONNECTION_DATABASE are the
 * minimum required for resolveConfig() to return a config without
 * a stored state file.
 */
function setEnvOnlyVars(dialect = 'postgres', database = 'testdb') {

    process.env.NOORM_CONNECTION_DIALECT = dialect;
    process.env.NOORM_CONNECTION_DATABASE = database;

}

function clearEnvOnlyVars() {

    delete process.env.NOORM_CONNECTION_DIALECT;
    delete process.env.NOORM_CONNECTION_DATABASE;
    delete process.env.NOORM_CONFIG;

}

afterEach(() => {

    clearEnvOnlyVars();

});

// ─────────────────────────────────────────────────────────────
// createContext factory
// ─────────────────────────────────────────────────────────────

describe('sdk: createContext factory', () => {

    it('rejects with "not found" when config name does not exist', async () => {

        const [, err] = await attempt(() => createContext({ config: '__nonexistent__' }));

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('not found');

    });

    it('returns an unconnected context in env-only mode', async () => {

        setEnvOnlyVars();

        const ctx = await createContext();

        expect(ctx.connected).toBe(false);

    });

    it('rejects with RequireTestError when requireTest is true and env-only config has isTest: false', async () => {

        // Env-only configs default to isTest: false (resolver.ts:68).
        // Pairing with requireTest: true exercises the guard.
        setEnvOnlyVars();

        const [, err] = await attempt(() =>
            createContext({ requireTest: true }),
        );

        expect(err).toBeInstanceOf(RequireTestError);

    });

    it('never opens the connection pool when requireTest check fails', async () => {

        // The pool only opens inside ctx.connect(), which is called by the
        // caller after createContext() succeeds.  When createContext() throws
        // (RequireTestError in this case), no Context is returned and therefore
        // connect() is never called — the pool never opens.
        // This test proves the rejection occurs before any Context is returned.
        setEnvOnlyVars();

        const [ctx, err] = await attempt(() =>
            createContext({ requireTest: true }),
        );

        expect(err).toBeInstanceOf(RequireTestError);
        // attempt() returns null (not a Context) when the factory throws,
        // confirming no Context was ever constructed and no pool was opened.
        expect(ctx).toBeNull();

    });

});

// ─────────────────────────────────────────────────────────────
// Context pre-connect behavior
// ─────────────────────────────────────────────────────────────

describe('sdk: Context pre-connect behavior', () => {

    it('throws "Not connected" when accessing ctx.kysely before connect()', async () => {

        setEnvOnlyVars();

        const ctx = await createContext();

        expect(() => ctx.kysely).toThrow('Not connected');

    });

});

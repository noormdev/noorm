/**
 * SDK createContext lifecycle tests.
 *
 * Tests factory behavior and pre-connect guards.
 * No ctx.connect() calls — no real DB required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attempt } from '@logosdx/utils';

import { createContext, RequireTestError } from '../../src/sdk/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../src/core/identity/index.js';
import { resetStateManager } from '../../src/core/state/index.js';
import { resetSettingsManager } from '../../src/core/settings/index.js';

let projectRoot: string;

beforeEach(async () => {

    projectRoot = await mkdtemp(join(tmpdir(), 'noorm-sdk-lifecycle-'));
    resetStateManager();
    resetSettingsManager();
    setKeyOverride((await generateKeyPair()).privateKey);

});

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

afterEach(async () => {

    clearEnvOnlyVars();
    clearKeyOverride();
    resetStateManager();
    resetSettingsManager();
    await rm(projectRoot, { recursive: true, force: true });

});

// ─────────────────────────────────────────────────────────────
// createContext factory
// ─────────────────────────────────────────────────────────────

describe('sdk: createContext factory', () => {

    it('rejects with "not found" when config name does not exist', async () => {

        const [, err] = await attempt(() => createContext({ config: '__nonexistent__', projectRoot }));

        expect(err).toBeInstanceOf(Error);
        expect.assertions(2);
        if (err instanceof Error) {

            expect(err.message).toContain('not found');

        }

    });

    it('returns an unconnected context in env-only mode', async () => {

        setEnvOnlyVars();

        const ctx = await createContext({ projectRoot });

        expect(ctx.connected).toBe(false);

    });

    it('rejects with RequireTestError when requireTest is true and env-only config has isTest: false', async () => {

        // Env-only configs default to isTest: false (resolver.ts:68).
        // Pairing with requireTest: true exercises the guard.
        setEnvOnlyVars();

        const [, err] = await attempt(() =>
            createContext({ requireTest: true, projectRoot }),
        );

        expect(err).toBeInstanceOf(RequireTestError);

    });


});

// ─────────────────────────────────────────────────────────────
// Context pre-connect behavior
// ─────────────────────────────────────────────────────────────

describe('sdk: Context pre-connect behavior', () => {

    it('throws "Not connected" when accessing ctx.kysely before connect()', async () => {

        setEnvOnlyVars();

        const ctx = await createContext({ projectRoot });

        expect(() => ctx.kysely).toThrow('Not connected');

    });

});

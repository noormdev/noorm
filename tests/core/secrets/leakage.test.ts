/**
 * Secret confidentiality tests.
 *
 * Secrets had no dedicated suite: coverage rode inside the settings and state
 * tests, and nothing anywhere asserted that a secret *value* stays out of the
 * places it must never reach. The audit that prompted this file found most of
 * its leaks by planting a distinctive value and grepping every output for it,
 * so that is the technique encoded here.
 *
 * Every test plants `SENTINEL` and asserts it is absent from a surface a
 * secret must never appear on. A test that fails here is a disclosure bug,
 * not a formatting difference.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { attempt } from '@logosdx/utils';

import { StateManager, resetStateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { observer } from '../../../src/core/observer.js';

/**
 * A value chosen to be unmistakable in a grep and impossible to produce by
 * accident. If this string turns up anywhere it was not written on purpose,
 * a secret escaped.
 */
const SENTINEL = 'CANARY_SEKRIT_9f3a_do_not_leak';

function createTestConfig(name: string): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
    };

}

describe('secrets: confidentiality', () => {

    let tempDir: string;
    let state: StateManager;

    beforeEach(async () => {

        resetStateManager();
        tempDir = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-secrets-test-'));

        const keyPair = await generateKeyPair();

        state = new StateManager(tempDir, {
            stateDir: '.test-state',
            stateFile: 'state.enc',
            privateKey: keyPair.privateKey,
        });

        await state.load();
        await state.setConfig('audit', createTestConfig('audit'));

    });

    afterEach(() => {

        if (existsSync(tempDir)) {

            rmSync(tempDir, { recursive: true });

        }

    });

    it('should never write a secret value in cleartext to the state file', async () => {

        await state.setSecret('audit', 'TOKEN', SENTINEL);

        const raw = readFileSync(join(tempDir, '.test-state', 'state.enc'));

        expect(raw.includes(SENTINEL)).toBe(false);
        expect(raw.toString('utf-8')).not.toContain(SENTINEL);

        // The value must still round-trip — absence alone would also be
        // satisfied by never storing it.
        expect(state.getSecret('audit', 'TOKEN')).toBe(SENTINEL);

    });

    it('should never put a secret value in an observer event payload', async () => {

        // A regex subscription, not '*' — the string form matches nothing, so
        // a wildcard-shaped version of this test would pass while observing
        // no events at all.
        const seen: string[] = [];
        const off = observer.on(/.*/ as never, (data: unknown) => {

            seen.push(JSON.stringify(data ?? null));

        });

        await state.setSecret('audit', 'TOKEN', SENTINEL);
        await state.deleteSecret('audit', 'TOKEN');

        off?.cleanup?.();

        // Guard against the assertion loop silently having nothing to check.
        expect(seen.length).toBeGreaterThan(0);

        for (const payload of seen) {

            expect(payload).not.toContain(SENTINEL);

        }

    });

    it('should list secret key names without their values', async () => {

        await state.setSecret('audit', 'TOKEN', SENTINEL);

        const keys = state.listSecrets('audit');

        expect(keys).toContain('TOKEN');
        expect(JSON.stringify(keys)).not.toContain(SENTINEL);

    });

    it('should not echo the value in the error raised by an invalid key', async () => {

        const [, err] = await attempt(() => state.setSecret('audit', 'bad-key!', SENTINEL));

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).not.toContain(SENTINEL);

    });

    it('should not echo the value in the error raised for an unknown config', async () => {

        const [, err] = await attempt(() => state.setSecret('nonexistent', 'TOKEN', SENTINEL));

        expect(err).toBeInstanceOf(Error);
        expect(err?.message).not.toContain(SENTINEL);

    });

    it('should keep a deleted secret out of both state and reads', async () => {

        await state.setSecret('audit', 'TOKEN', SENTINEL);
        await state.deleteSecret('audit', 'TOKEN');

        expect(state.getSecret('audit', 'TOKEN')).toBeNull();

        const raw = readFileSync(join(tempDir, '.test-state', 'state.enc'));

        expect(raw.includes(SENTINEL)).toBe(false);

    });

    it('should scope a secret to its config so another config cannot read it', async () => {

        await state.setConfig('other', createTestConfig('other'));
        await state.setSecret('audit', 'TOKEN', SENTINEL);

        expect(state.getSecret('other', 'TOKEN')).toBeNull();
        expect(JSON.stringify(state.listSecrets('other'))).not.toContain(SENTINEL);

    });

});

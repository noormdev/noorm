/**
 * Template context builder tests — the $.secrets proxy.
 *
 * $.secrets used to be a plain object: a missing key read as `undefined`,
 * which sqlQuote then stringified into the literal SQL text 'undefined'
 * (noorm#50). These tests pin the replacement contract: a missing key
 * throws naming it, while existence can still be probed without throwing.
 */
import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import { buildContext, MissingSecretError } from '../../../src/core/template/context.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/engine');
const TEMPLATE_PATH = path.join(FIXTURES_DIR, 'template.sql.tmpl');

describe('template: context — secrets proxy', () => {

    it('should throw MissingSecretError naming the key on an unresolved secret', async () => {

        const ctx = await buildContext(TEMPLATE_PATH, {
            projectRoot: FIXTURES_DIR,
            secrets: { API_KEY: 'secret123' },
        });

        expect(() => ctx.secrets.MISSING).toThrow(MissingSecretError);
        expect(() => ctx.secrets.MISSING).toThrow(/MISSING/);
        expect(() => ctx.secrets.MISSING).toThrow(/config-local/);

    });

    it('should name every tier it searches, and only those', async () => {

        // Every render-path caller sources `secrets` from buildSecretsContext,
        // which merges config-local, global-local, and vault. The message has
        // to match that set exactly: naming a tier nobody searched sends the
        // reader looking in the wrong place, omitting one hides where the
        // value should have come from. This test is the thing that fails when
        // the two drift apart.
        const ctx = await buildContext(TEMPLATE_PATH, {
            projectRoot: FIXTURES_DIR,
            secrets: {},
        });

        expect(() => ctx.secrets.MISSING).toThrow(/config-local/);
        expect(() => ctx.secrets.MISSING).toThrow(/global-local/);
        expect(() => ctx.secrets.MISSING).toThrow(/vault/);

    });

    it('should still resolve a present key, including through ??', async () => {

        const ctx = await buildContext(TEMPLATE_PATH, {
            projectRoot: FIXTURES_DIR,
            secrets: { API_KEY: 'secret123' },
        });

        expect(ctx.secrets.API_KEY).toBe('secret123');
        expect(ctx.secrets.API_KEY ?? 'fallback').toBe('secret123');

    });

    it('should support `in` to probe for an optional secret without throwing', async () => {

        const ctx = await buildContext(TEMPLATE_PATH, {
            projectRoot: FIXTURES_DIR,
            secrets: { API_KEY: 'secret123' },
        });

        expect('API_KEY' in ctx.secrets).toBe(true);
        expect('MISSING' in ctx.secrets).toBe(false);

        const optional = 'MISSING' in ctx.secrets ? ctx.secrets.MISSING : 'fallback';

        expect(optional).toBe('fallback');

    });

    it('should not throw for Object.keys, spread, or JSON.stringify of the context', async () => {

        const ctx = await buildContext(TEMPLATE_PATH, {
            projectRoot: FIXTURES_DIR,
            secrets: { API_KEY: 'secret123' },
        });

        expect(Object.keys(ctx.secrets)).toEqual(['API_KEY']);
        expect({ ...ctx.secrets }).toEqual({ API_KEY: 'secret123' });

        expect(() => JSON.stringify(ctx)).not.toThrow();
        expect(JSON.parse(JSON.stringify(ctx)).secrets).toEqual({ API_KEY: 'secret123' });

    });

});

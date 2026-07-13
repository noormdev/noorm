/**
 * Tests for the `--insecure` / `NOORM_INSECURE` checksum-verification escape
 * hatch's arg/env resolution.
 *
 * Scoped to `isInsecureMode`'s truthy/falsy parsing only — mirrors
 * `tests/cli/yes-flag.test.ts`'s coverage of `isYesMode`. The binary-swap
 * path this flag ultimately gates (`installViaBinary`) is deliberately not
 * exercised here: swapping over the test runner's own `process.execPath`
 * is out of scope (see `tests/core/update/updater.test.ts`), and the
 * mismatch-always-throws invariant it protects is already proven in
 * `tests/core/update/checksum.test.ts`. This file only proves the flag
 * resolves the same way `--yes`/`NOORM_YES` does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { isInsecureMode } from '../../src/cli/_utils.js';

describe('cli: isInsecureMode helper', () => {

    let originalInsecure: string | undefined;

    beforeEach(() => {

        originalInsecure = process.env['NOORM_INSECURE'];
        delete process.env['NOORM_INSECURE'];

    });

    afterEach(() => {

        if (originalInsecure === undefined) {

            delete process.env['NOORM_INSECURE'];

        }
        else {

            process.env['NOORM_INSECURE'] = originalInsecure;

        }

    });

    it('returns true when args.insecure is true', () => {

        expect(isInsecureMode({ insecure: true })).toBe(true);

    });

    it('returns true when NOORM_INSECURE=1', () => {

        process.env['NOORM_INSECURE'] = '1';

        expect(isInsecureMode({})).toBe(true);

    });

    it('returns true when NOORM_INSECURE=true', () => {

        process.env['NOORM_INSECURE'] = 'true';

        expect(isInsecureMode({})).toBe(true);

    });

    it('returns false when NOORM_INSECURE=0', () => {

        process.env['NOORM_INSECURE'] = '0';

        expect(isInsecureMode({})).toBe(false);

    });

    it('returns false when NOORM_INSECURE=false (case-insensitive)', () => {

        process.env['NOORM_INSECURE'] = 'False';

        expect(isInsecureMode({})).toBe(false);

    });

    it('returns false when NOORM_INSECURE is empty string', () => {

        process.env['NOORM_INSECURE'] = '';

        expect(isInsecureMode({})).toBe(false);

    });

    it('returns false when neither the flag nor the env var is set', () => {

        expect(isInsecureMode({})).toBe(false);

    });

    it('--insecure flag wins over NOORM_INSECURE=0', () => {

        process.env['NOORM_INSECURE'] = '0';

        expect(isInsecureMode({ insecure: true })).toBe(true);

    });

});

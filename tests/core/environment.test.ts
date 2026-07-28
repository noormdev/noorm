/**
 * Environment detection tests.
 *
 * NOORM_DEBUG truthiness rule (isEnvTruthy, shared with NOORM_YES): empty,
 * unset, `'0'`, or `'false'` (any case) disables; any other non-empty value
 * enables. Regression coverage for the bug where `NOORM_DEBUG=0` used to
 * *enable* debug output at raw-truthiness call sites (observer.ts spy,
 * connection/manager.ts logging) because any non-empty string, including
 * `'0'`, is truthy in JS.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';

import { isDebug } from '../../src/core/environment.js';

describe('environment: isDebug', () => {

    const original = process.env['NOORM_DEBUG'];

    afterEach(() => {

        if (original === undefined) {

            delete process.env['NOORM_DEBUG'];

        }
        else {

            process.env['NOORM_DEBUG'] = original;

        }

    });

    it('should disable when NOORM_DEBUG is unset', () => {

        delete process.env['NOORM_DEBUG'];

        expect(isDebug()).toBe(false);

    });

    it('should disable when NOORM_DEBUG is empty', () => {

        process.env['NOORM_DEBUG'] = '';

        expect(isDebug()).toBe(false);

    });

    it('should disable when NOORM_DEBUG=0', () => {

        process.env['NOORM_DEBUG'] = '0';

        expect(isDebug()).toBe(false);

    });

    it('should disable when NOORM_DEBUG=false in any letter case', () => {

        process.env['NOORM_DEBUG'] = 'false';
        expect(isDebug()).toBe(false);

        process.env['NOORM_DEBUG'] = 'FALSE';
        expect(isDebug()).toBe(false);

    });

    it('should enable when NOORM_DEBUG=1', () => {

        process.env['NOORM_DEBUG'] = '1';

        expect(isDebug()).toBe(true);

    });

    it('should enable when NOORM_DEBUG=true', () => {

        process.env['NOORM_DEBUG'] = 'true';

        expect(isDebug()).toBe(true);

    });

    it('should enable when NOORM_DEBUG=yes', () => {

        process.env['NOORM_DEBUG'] = 'yes';

        expect(isDebug()).toBe(true);

    });

});

describe('environment: NOORM_DEBUG module-scope evaluation (observer spy)', () => {

    /**
     * observer.ts reads `isDebug()` once at module load time to wire the
     * ObserverEngine `spy` option (`export const observer = new
     * ObserverEngine(...)`), so mutating process.env after this test file's
     * own import of observer.ts would not re-evaluate it. Each value is
     * checked in a fresh subprocess so the module loads against the exact
     * env it should observe. Uses `bun -e` against the TS source directly
     * (no build step) rather than the built CLI binary that other
     * subprocess CLI tests spawn via `spawnSync('node', [dist/cli/index.js])`
     * — observer.ts isn't a CLI entrypoint, so there's no dist artifact to
     * invoke.
     */
    async function hasSpyForDebugValue(value: string): Promise<boolean> {

        const proc = Bun.spawn({
            cmd: [
                'bun', '-e',
                'const { observer } = await import(\'./src/core/observer.ts\');'
                + 'console.log(JSON.stringify(observer.$facts().hasSpy));',
            ],
            cwd: join(import.meta.dir, '../..'),
            env: { ...process.env, NOORM_DEBUG: value },
            stdout: 'pipe',
            stderr: 'inherit',
        });

        const stdout = await new Response(proc.stdout).text();
        await proc.exited;

        return JSON.parse(stdout.trim());

    }

    it('should not enable the observer spy when NOORM_DEBUG=0', async () => {

        expect(await hasSpyForDebugValue('0')).toBe(false);

    });

    it('should enable the observer spy when NOORM_DEBUG=1', async () => {

        expect(await hasSpyForDebugValue('1')).toBe(true);

    });

});

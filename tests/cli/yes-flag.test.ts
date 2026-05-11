/**
 * Tests for the universal --yes / NOORM_YES non-interactive opt-in.
 *
 * Covers:
 * - `isYesMode` helper truthy/falsy semantics
 * - Per-command behavior on non-TTY for the four TTY-gated commands:
 *     `noorm init`, `noorm sql repl`, `noorm settings edit`,
 *     `noorm settings secret`
 *
 * Subprocess tests redirect stdin from /dev/null to ensure stdin.isTTY is
 * false. Identity-existence tests for `noorm init` redirect $HOME to a
 * tmpdir so the user's real ~/.noorm/identity.* files are never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { isYesMode } from '../../src/cli/_utils.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: isYesMode helper', () => {

    let originalYes: string | undefined;

    beforeEach(() => {

        originalYes = process.env['NOORM_YES'];
        delete process.env['NOORM_YES'];

    });

    afterEach(() => {

        if (originalYes === undefined) {

            delete process.env['NOORM_YES'];

        }
        else {

            process.env['NOORM_YES'] = originalYes;

        }

    });

    it('returns true when args.yes is true', () => {

        expect(isYesMode({ yes: true })).toBe(true);

    });

    it('returns true when NOORM_YES=1', () => {

        process.env['NOORM_YES'] = '1';

        expect(isYesMode({})).toBe(true);

    });

    it('returns true when NOORM_YES=true', () => {

        process.env['NOORM_YES'] = 'true';

        expect(isYesMode({})).toBe(true);

    });

    it('returns true when NOORM_YES=yes', () => {

        process.env['NOORM_YES'] = 'yes';

        expect(isYesMode({})).toBe(true);

    });

    it('returns true when NOORM_YES=TRUE (case-insensitive)', () => {

        process.env['NOORM_YES'] = 'TRUE';

        expect(isYesMode({})).toBe(true);

    });

    it('returns false when NOORM_YES=0', () => {

        process.env['NOORM_YES'] = '0';

        expect(isYesMode({})).toBe(false);

    });

    it('returns false when NOORM_YES=false', () => {

        process.env['NOORM_YES'] = 'false';

        expect(isYesMode({})).toBe(false);

    });

    it('returns false when NOORM_YES=False (case-insensitive)', () => {

        process.env['NOORM_YES'] = 'False';

        expect(isYesMode({})).toBe(false);

    });

    it('returns false when NOORM_YES is empty string', () => {

        process.env['NOORM_YES'] = '';

        expect(isYesMode({})).toBe(false);

    });

    it('returns false when NOORM_YES is unset and args.yes is not set', () => {

        expect(isYesMode({})).toBe(false);

    });

    it('--yes flag wins over NOORM_YES=0', () => {

        process.env['NOORM_YES'] = '0';

        expect(isYesMode({ yes: true })).toBe(true);

    });

});

describe('cli: noorm sql repl --yes / NOORM_YES', () => {

    it('errors with redirect hint when --yes is set on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'sql', 'repl', '--yes'], {
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive only');
        expect(out).toContain('noorm sql query');

    });

    it('errors with redirect hint when NOORM_YES=1 on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'sql', 'repl'], {
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '1' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive only');

    });

    it('still emits the TTY refusal when neither flag nor env is set', () => {

        const result = spawnSync('node', [CLI, 'sql', 'repl'], {
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '' },
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('interactive terminal');

    });

    it('treats NOORM_YES=0 as not set (TTY refusal, not redirect)', () => {

        const result = spawnSync('node', [CLI, 'sql', 'repl'], {
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '0' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive terminal');
        expect(out).not.toContain('interactive only');

    });

});

describe('cli: noorm settings edit --yes / NOORM_YES', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-yes-edit-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('errors with redirect hint when --yes is set on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'settings', 'edit', '--yes'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive only');
        expect(out).toContain('settings.yml');

    });

    it('errors with redirect hint when NOORM_YES=1 on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'settings', 'edit'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '1' },
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('interactive only');

    });

    it('treats NOORM_YES=0 as not set (TTY refusal, not redirect)', () => {

        const result = spawnSync('node', [CLI, 'settings', 'edit'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '0' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive terminal');
        expect(out).not.toContain('interactive only');

    });

});

describe('cli: noorm settings secret --yes / NOORM_YES', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-yes-secret-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n',
        );

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('errors with redirect hint when --yes is set on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'settings', 'secret', '--yes'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive only');
        expect(out).toContain("'secrets' section");

    });

    it('errors with redirect hint when NOORM_YES=1 on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'settings', 'secret'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '1' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive only');
        expect(out).toContain('noorm secret set');

    });

    it('treats NOORM_YES=0 as not set (TTY refusal, not redirect)', () => {

        const result = spawnSync('node', [CLI, 'settings', 'secret'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: { ...process.env, NOORM_YES: '0' },
        });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive terminal');
        expect(out).not.toContain('interactive only');

    });

});

describe('cli: noorm init --yes / NOORM_YES', () => {

    let tmpDir: string;
    let fakeHome: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-yes-init-'));
        // Isolate $HOME so identity lookups never see the developer's real
        // ~/.noorm/identity.* files. The CLI computes identity paths from
        // homedir() at module load, which honors $HOME on macOS/Linux.
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-yes-home-'));

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    function runInit(args: string[], envOverrides: Record<string, string> = {}) {

        return spawnSync('node', [CLI, 'init', ...args], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: {
                ...process.env,
                HOME: fakeHome,
                USERPROFILE: fakeHome,
                NOORM_YES: '',
                ...envOverrides,
            },
        });

    }

    it('errors with the documented identity hint when --yes is set and identity is missing', () => {

        const result = runInit(['--yes']);

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('noorm init --yes requires an existing identity');
        expect(out).toContain('noorm identity init --name');
        expect(out).toContain('Then re-run: noorm init --yes');

    });

    it('errors with the documented identity hint when NOORM_YES=1 and identity is missing', () => {

        const result = runInit([], { NOORM_YES: '1' });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('requires an existing identity');

    });

    it('emits the original TTY refusal when neither flag nor env is set', () => {

        const result = runInit([]);

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive terminal');
        expect(out).not.toContain('requires an existing identity');

    });

    it('treats NOORM_YES=0 as not set (TTY refusal)', () => {

        const result = runInit([], { NOORM_YES: '0' });

        expect(result.status).toBe(1);

        const out = result.stderr + result.stdout;

        expect(out).toContain('interactive terminal');
        expect(out).not.toContain('requires an existing identity');

    });

    it('succeeds with --yes when full identity exists in fake HOME', () => {

        // Provision a full crypto identity inside the isolated HOME first.
        // We do this by invoking the CLI itself — identity init is fully
        // non-interactive (--name / --email) and there's no other way to
        // produce the exact key shape the runtime expects.
        const seed = spawnSync('node', [
            CLI,
            'identity', 'init',
            '--name', 'CI Bot',
            '--email', 'ci@example.com',
        ], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
            env: {
                ...process.env,
                HOME: fakeHome,
                USERPROFILE: fakeHome,
            },
        });

        expect(seed.status).toBe(0);
        expect(existsSync(join(fakeHome, '.noorm', 'identity.key'))).toBe(true);
        expect(existsSync(join(fakeHome, '.noorm', 'identity.pub'))).toBe(true);
        expect(existsSync(join(fakeHome, '.noorm', 'identity.json'))).toBe(true);

        const result = runInit(['--yes']);

        expect(result.status).toBe(0);
        expect(existsSync(join(tmpDir, '.noorm'))).toBe(true);
        expect(existsSync(join(tmpDir, '.noorm', 'settings.yml'))).toBe(true);

    });

});

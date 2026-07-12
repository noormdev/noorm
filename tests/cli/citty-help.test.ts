/**
 * Smoke test for the citty --help interceptor.
 *
 * Verifies that invoking --help on a leaf command prints citty's
 * auto-generated usage followed by our custom EXAMPLES block.
 */
import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

const BIN = 'bun';
const ENTRY = 'src/cli/index.ts';

function runCli(args: string[]): { stdout: string; stderr: string; code: number | null } {

    const result = spawnSync(BIN, [ENTRY, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
    });

    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        code: result.status,
    };

}

describe('cli: citty help interceptor', () => {

    it('should print usage and examples for change ff --help', () => {

        const { stdout, code } = runCli(['change', 'ff', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('USAGE');
        expect(stdout).toContain('Fast-forward');
        expect(stdout).toContain('EXAMPLES');
        expect(stdout).toContain('noorm change ff');

    });

    it('should print usage for parent command without examples', () => {

        const { stdout, code } = runCli(['change', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('COMMANDS');
        expect(stdout).toContain('ff');

    });

    it('should print root help', () => {

        const { stdout, code } = runCli(['--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('COMMANDS');

    });

});

describe('cli: citty help interceptor - breadcrumb depth', () => {

    it('should print the full parent breadcrumb for a 2-level-deep command (change add)', () => {

        const { stdout, code } = runCli(['change', 'add', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('USAGE noorm change add');

    });

    it('should print the full parent breadcrumb for a 3-level-deep command (db explore tables)', () => {

        const { stdout, code } = runCli(['db', 'explore', 'tables', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('USAGE noorm db explore tables');

    });

    it('should print the full parent breadcrumb for a 3-level-deep command (ci identity enroll)', () => {

        const { stdout, code } = runCli(['ci', 'identity', 'enroll', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('USAGE noorm ci identity enroll');

    });

    it('should print a single noorm segment for root --help, never doubled', () => {

        const { stdout, code } = runCli(['--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('USAGE noorm ');
        expect(stdout).not.toContain('noorm noorm');

    });

});

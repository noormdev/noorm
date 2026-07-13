/**
 * cli: noorm config edit — honest exit-1 stub.
 *
 * `config edit` is TUI-only and can never run headlessly; it calls
 * `process.exit`, so — like every other citty command test in this suite —
 * it's driven as a subprocess against the compiled CLI (tests/cli/db/drop.test.ts's
 * pattern) rather than invoked in-process. Covers both invocation shapes
 * (with and without the positional `name` arg) to prove arg parsing is
 * untouched by the stream/exit-code fix.
 */
import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

function runEdit(args: string[] = []): ReturnType<typeof spawnSync> {

    return spawnSync('node', [CLI, 'config', 'edit', ...args], {
        encoding: 'utf-8',
        stdio: 'pipe',
    });

}

describe('cli: noorm config edit — honest exit-1 stub', () => {

    it('exits 1 without a positional name arg', () => {

        const result = runEdit();

        expect(result.status).toBe(1);

    });

    it('writes "Interactive only" to stderr, not stdout, without a positional name arg', () => {

        const result = runEdit();

        expect(result.stderr).toContain('Interactive only — run: noorm ui');
        expect(result.stdout).not.toContain('Interactive only');

    });

    it('exits 1 with a positional name arg', () => {

        const result = runEdit(['myconfig']);

        expect(result.status).toBe(1);

    });

    it('writes "Interactive only" to stderr, not stdout, with a positional name arg', () => {

        const result = runEdit(['myconfig']);

        expect(result.stderr).toContain('Interactive only — run: noorm ui');
        expect(result.stdout).not.toContain('Interactive only');

    });

});

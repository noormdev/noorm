/**
 * cli: noorm config add — honest exit-1 stub.
 *
 * `config add` is TUI-only and can never run headlessly; it calls
 * `process.exit`, so — like every other citty command test in this suite —
 * it's driven as a subprocess against the compiled CLI (tests/cli/db/drop.test.ts's
 * pattern) rather than invoked in-process.
 */
import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

function runAdd(): ReturnType<typeof spawnSync> {

    return spawnSync('node', [CLI, 'config', 'add'], {
        encoding: 'utf-8',
        stdio: 'pipe',
    });

}

describe('cli: noorm config add — honest exit-1 stub', () => {

    it('exits 1', () => {

        const result = runAdd();

        expect(result.status).toBe(1);

    });

    it('writes "Interactive only" to stderr, not stdout', () => {

        const result = runAdd();

        expect(result.stderr).toContain('Interactive only — run: noorm ui');
        expect(result.stdout).not.toContain('Interactive only');

    });

});

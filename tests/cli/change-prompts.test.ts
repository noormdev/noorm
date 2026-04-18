import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

function runCli(tmpDir: string, args: string[], env: Record<string, string> = {}) {

    return spawnSync('node', [CLI, ...args], {
        cwd: tmpDir,
        input: '',
        encoding: 'utf-8',
        env: { ...process.env, ...env },
    });

}

describe('cli: change subcommand prompts on non-TTY', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-change-prompts-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('change add errors without a description', () => {

        const r = runCli(tmpDir, ['change', 'add']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Change description required');

    });

    it('change rm errors without a name', () => {

        const r = runCli(tmpDir, ['change', 'rm']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Change name required');

    });

    it('change rm errors without --yes even when name is given', () => {

        const changePath = join(tmpDir, 'changes', '2024-04-17-sample');
        mkdirSync(changePath, { recursive: true });

        const r = runCli(tmpDir, ['change', 'rm', '2024-04-17-sample']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Pass --yes');

    });

    it('change run errors without a name', () => {

        const r = runCli(tmpDir, ['change', 'run']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Change name required');

    });

    it('change revert errors without a name', () => {

        const r = runCli(tmpDir, ['change', 'revert']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Change name required');

    });

    it('change rewind errors without a name', () => {

        const r = runCli(tmpDir, ['change', 'rewind']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Change name required');

    });

    it('change history-detail errors without a name', () => {

        const r = runCli(tmpDir, ['change', 'history-detail']);

        expect(r.status).toBe(1);
        expect(r.stderr + r.stdout).toContain('Change name required');

    });

});

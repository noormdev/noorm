import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm change edit', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-change-edit-'));

        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('exits 1 with helpful message when name omitted on non-TTY', () => {

        const result = spawnSync('node', [CLI, 'change', 'edit'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('Change name required');

    });

    it('exits 2 when change does not exist', () => {

        const result = spawnSync('node', [CLI, 'change', 'edit', 'nope'], {
            cwd: tmpDir,
            encoding: 'utf-8',
        });

        expect(result.status).toBe(2);
        expect(result.stderr + result.stdout).toContain('Change not found');

    });

    it('exits 0 when editor opens successfully', () => {

        const changePath = join(tmpDir, 'changes', '2024-04-17-sample');
        mkdirSync(changePath, { recursive: true });
        writeFileSync(join(changePath, 'up.sql'), '-- noop\n');

        const result = spawnSync('node', [CLI, 'change', 'edit', '2024-04-17-sample'], {
            cwd: tmpDir,
            env: { ...process.env, EDITOR: 'true' },
            encoding: 'utf-8',
        });

        expect(result.status).toBe(0);

    });

    it('exits 1 when editor binary is missing', () => {

        const changePath = join(tmpDir, 'changes', '2024-04-17-sample');
        mkdirSync(changePath, { recursive: true });

        const result = spawnSync('node', [CLI, 'change', 'edit', '2024-04-17-sample'], {
            cwd: tmpDir,
            env: { ...process.env, EDITOR: '/nonexistent/editor-xyz' },
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('Failed to open editor');

    });

    it('propagates editor non-zero exit code', () => {

        const changePath = join(tmpDir, 'changes', '2024-04-17-sample');
        mkdirSync(changePath, { recursive: true });

        const result = spawnSync('node', [CLI, 'change', 'edit', '2024-04-17-sample'], {
            cwd: tmpDir,
            env: { ...process.env, EDITOR: 'false' },
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);

    });

});

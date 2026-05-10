import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm init', () => {

    let tmpDir: string;
    let originalCwd: string;

    beforeEach(() => {

        originalCwd = process.cwd();
        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-init-test-'));

    });

    afterEach(() => {

        process.chdir(originalCwd);
        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('should exit 1 when stdin is not a TTY', () => {

        const result = spawnSync('node', [CLI, 'init'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('interactive terminal');

    });

    it('should exit 1 when .noorm/ exists without --force (TTY check bypass needed)', () => {

        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), '');

        const result = spawnSync('node', [CLI, 'init'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);

    });

    it.skip('should succeed without prompts when identity already exists globally (pty required)', () => {

        // Requires a PTY and globally present identity. Covered manually during QA.

    });

    it('should not error on parent .noorm when run from a subfolder with --here', () => {

        // Parent has .noorm — without --here the CLI walks up, treats parent
        // as the project, and refuses to re-init. With --here the subfolder
        // is treated as its own project and we hit the TTY gate (exit 1)
        // BEFORE the already-initialized check would fire.
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), '');

        const subDir = join(tmpDir, 'sub');
        mkdirSync(subDir, { recursive: true });

        const without = spawnSync('node', [CLI, 'init'], {
            cwd: subDir,
            input: '',
            encoding: 'utf-8',
        });
        expect(without.status).toBe(1);
        expect(without.stderr + without.stdout).toContain('already initialized');

        const withHere = spawnSync('node', [CLI, 'init', '--here'], {
            cwd: subDir,
            input: '',
            encoding: 'utf-8',
        });
        expect(withHere.status).toBe(1);
        expect(withHere.stderr + withHere.stdout).toContain('interactive terminal');
        expect(withHere.stderr + withHere.stdout).not.toContain('already initialized');

    });

    it('should accept global -c <path> to operate inside the given directory', () => {

        const subDir = join(tmpDir, 'pkg');
        mkdirSync(subDir, { recursive: true });

        // -c points at the subfolder; init runs there and hits the TTY gate.
        const result = spawnSync('node', [CLI, '-c', subDir, 'init'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('interactive terminal');
        expect(result.stderr + result.stdout).not.toContain('already initialized');

    });

    it('should reject global -c with a path that is not a directory', () => {

        const result = spawnSync('node', [CLI, '-c', join(tmpDir, 'nope'), 'init'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('not a directory');

    });

});

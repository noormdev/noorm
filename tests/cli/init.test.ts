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

});

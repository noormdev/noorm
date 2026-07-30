import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm settings edit', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-settings-edit-'));

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('exits 1 when stdin is not a TTY', () => {

        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

        const result = spawnSync('node', [CLI, 'settings', 'edit'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(2);
        expect(result.stderr + result.stdout).toContain('interactive terminal');

    });

    it('exits 1 when settings.yml does not exist', () => {

        const result = spawnSync('node', [CLI, 'settings', 'edit'], {
            cwd: tmpDir,
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(2);

    });

});

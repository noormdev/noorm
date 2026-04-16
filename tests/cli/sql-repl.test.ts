import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm sql repl', () => {

    it('should exit 1 when stdin is not a TTY', () => {

        const result = spawnSync('node', [CLI, 'sql', 'repl'], {
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain('interactive terminal');

    });

    it('should exit 1 when --config references an unknown config (non-TTY bypass intentional)', () => {

        const result = spawnSync('node', [CLI, 'sql', 'repl', '--config', 'nonexistent'], {
            input: '',
            encoding: 'utf-8',
        });

        expect(result.status).toBe(1);

    });

});

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../src/core/identity/crypto.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: env-based identity bootstrap', () => {

    let tmpDir: string;
    let fakeHome: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-env-bootstrap-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-env-bootstrap-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n    changes: ./changes\n');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    it('runs noorm info without ~/.noorm/ files when env vars are set', () => {

        const { privateKey } = generateKeyPair();

        const result = spawnSync('node', [CLI, 'info', '--json'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: {
                ...process.env,
                HOME: fakeHome,
                NOORM_IDENTITY_PRIVATE_KEY: privateKey,
                NOORM_IDENTITY_NAME: 'CI Bot',
                NOORM_IDENTITY_EMAIL: 'ci@example.com',
            },
        });

        expect(result.status).toBe(0);
        const json = JSON.parse(result.stdout.trim());
        const blob = JSON.stringify(json);
        expect(blob).toContain('CI Bot');
        expect(blob).toContain('ci@example.com');

    });

    it('falls through to disk when env vars are not set', () => {

        const result = spawnSync('node', [CLI, 'info', '--json'], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env: {
                ...process.env,
                HOME: fakeHome,
                NOORM_IDENTITY_PRIVATE_KEY: '',
                NOORM_IDENTITY_NAME: '',
                NOORM_IDENTITY_EMAIL: '',
            },
        });

        const blob = result.stdout + result.stderr;
        expect(blob).not.toContain('CI Bot');

    });

});

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

interface EnvOverrides {
    NOORM_IDENTITY_PRIVATE_KEY?: string;
    NOORM_IDENTITY_NAME?: string;
    NOORM_IDENTITY_EMAIL?: string;
    NOORM_CONNECTION_DIALECT?: string;
    NOORM_CONNECTION_DATABASE?: string;
    NOORM_CONNECTION_HOST?: string;
    NOORM_CONNECTION_PORT?: string;
    NOORM_CONNECTION_USER?: string;
    NOORM_CONNECTION_PASSWORD?: string;
}

function cleanEnvWithOverrides(overrides: EnvOverrides): Record<string, string> {

    const env: Record<string, string> = {};

    for (const [k, v] of Object.entries(process.env)) {

        if (v !== undefined && !k.startsWith('NOORM_')) env[k] = v;

    }

    for (const [k, v] of Object.entries(overrides)) {

        if (v !== undefined) env[k] = v;

    }

    return env;

}

function initCi(cwd: string) {

    const env = cleanEnvWithOverrides({
        NOORM_IDENTITY_PRIVATE_KEY: generateKeyPair().privateKey,
        NOORM_IDENTITY_NAME: 'CI Bot',
        NOORM_IDENTITY_EMAIL: 'ci@test.com',
        NOORM_CONNECTION_DIALECT: 'postgres',
        NOORM_CONNECTION_HOST: 'localhost',
        NOORM_CONNECTION_PORT: '5432',
        NOORM_CONNECTION_DATABASE: 'app',
        NOORM_CONNECTION_USER: 'app',
        NOORM_CONNECTION_PASSWORD: 'secret',
    });

    // Persist the identity private key so later `ci secrets` invocations
    // (which do not take identity env themselves) can still decrypt state.
    const result = spawnSync('node', [CLI, 'ci', 'init'], { cwd, encoding: 'utf-8', env });

    return { result, identityEnv: env };

}

function runSecrets(
    cwd: string,
    identityEnv: Record<string, string>,
    file: string,
    extra: string[] = [],
): ReturnType<typeof spawnSync> {

    return spawnSync('node', [CLI, 'ci', 'secrets', '--file', file, ...extra], {
        cwd,
        encoding: 'utf-8',
        env: identityEnv,
    });

}

describe('cli: noorm ci secrets', () => {

    let tmpDir: string;
    let secretsFile: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-ci-secrets-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');
        secretsFile = join(tmpDir, 'ci.env');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('loads all keys on first run', () => {

        const { result: init, identityEnv } = initCi(tmpDir);
        expect(init.status).toBe(0);

        writeFileSync(secretsFile, 'FOO=one\nBAR=two\nBAZ=three\n');

        const result = runSecrets(tmpDir, identityEnv, secretsFile, ['--json']);

        expect(result.status).toBe(0);

        const json = JSON.parse(result.stdout.trim());
        expect(json.success).toBe(true);
        expect(json.set).toBe(3);
        expect(json.skipped).toBe(0);
        expect(json.errors).toBe(0);

    });

    it('skips existing keys on rerun without --overwrite', () => {

        const { result: init, identityEnv } = initCi(tmpDir);
        expect(init.status).toBe(0);

        writeFileSync(secretsFile, 'FOO=one\nBAR=two\n');

        const first = runSecrets(tmpDir, identityEnv, secretsFile, ['--json']);
        expect(first.status).toBe(0);

        const second = runSecrets(tmpDir, identityEnv, secretsFile, ['--json']);
        expect(second.status).toBe(0);

        const json = JSON.parse(second.stdout.trim());
        expect(json.set).toBe(0);
        expect(json.skipped).toBe(2);

    });

    it('replaces existing keys with --overwrite', () => {

        const { result: init, identityEnv } = initCi(tmpDir);
        expect(init.status).toBe(0);

        writeFileSync(secretsFile, 'FOO=one\n');

        const first = runSecrets(tmpDir, identityEnv, secretsFile, ['--json']);
        expect(first.status).toBe(0);

        writeFileSync(secretsFile, 'FOO=replaced\n');
        const second = runSecrets(tmpDir, identityEnv, secretsFile, ['--overwrite', '--json']);

        expect(second.status).toBe(0);

        const json = JSON.parse(second.stdout.trim());
        expect(json.set).toBe(1);
        expect(json.skipped).toBe(0);

    });

    it('ignores blank lines, comments, and preserves = in values', () => {

        const { result: init, identityEnv } = initCi(tmpDir);
        expect(init.status).toBe(0);

        writeFileSync(
            secretsFile,
            [
                '# comment line',
                '',
                'URL=https://a.b/?x=1&y=2',
                'QUOTED="value with spaces"',
                "SQUOTED='single value'",
            ].join('\n'),
        );

        const result = runSecrets(tmpDir, identityEnv, secretsFile, ['--json']);

        expect(result.status).toBe(0);

        const json = JSON.parse(result.stdout.trim());
        expect(json.set).toBe(3);
        expect(json.errors).toBe(0);

    });

    it('exits 2 on malformed line', () => {

        const { result: init, identityEnv } = initCi(tmpDir);
        expect(init.status).toBe(0);

        writeFileSync(secretsFile, 'NOT_VALID_LINE\n');

        const result = runSecrets(tmpDir, identityEnv, secretsFile, ['--json']);

        expect(result.status).toBe(2);
        expect(result.stdout + result.stderr).toContain('Parse error');

    });

    it('exits 2 when state.enc does not exist', () => {

        writeFileSync(secretsFile, 'FOO=one\n');

        const env = cleanEnvWithOverrides({
            NOORM_IDENTITY_PRIVATE_KEY: generateKeyPair().privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@test.com',
        });

        const result = runSecrets(tmpDir, env, secretsFile, ['--json']);

        expect(result.status).toBe(2);
        expect(result.stdout + result.stderr).toContain('ci init');

    });

});

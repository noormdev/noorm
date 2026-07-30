import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/manager.js';

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
    NOORM_CI_CONFIG_NAME?: string;
}

function runInit(
    cwd: string,
    envOverrides: EnvOverrides,
    extraArgs: string[] = [],
): ReturnType<typeof spawnSync> {

    const cleanEnv: Record<string, string> = {};

    for (const [k, v] of Object.entries(process.env)) {

        if (v !== undefined && !k.startsWith('NOORM_')) cleanEnv[k] = v;

    }

    for (const [k, v] of Object.entries(envOverrides)) {

        if (v !== undefined) cleanEnv[k] = v;

    }

    return spawnSync('node', [CLI, 'ci', 'init', ...extraArgs], {
        cwd,
        encoding: 'utf-8',
        env: cleanEnv,
    });

}

function validIdentityEnv() {

    const { privateKey } = generateKeyPair();

    return {
        NOORM_IDENTITY_PRIVATE_KEY: privateKey,
        NOORM_IDENTITY_NAME: 'CI Bot',
        NOORM_IDENTITY_EMAIL: 'ci@test.com',
    };

}

function validConnectionEnv() {

    return {
        NOORM_CONNECTION_DIALECT: 'postgres',
        NOORM_CONNECTION_HOST: 'localhost',
        NOORM_CONNECTION_PORT: '5432',
        NOORM_CONNECTION_DATABASE: 'app',
        NOORM_CONNECTION_USER: 'app',
        NOORM_CONNECTION_PASSWORD: 'secret',
    };

}

describe('cli: noorm ci init', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-ci-init-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('writes an ephemeral state.enc and marks config active', () => {

        const result = runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() }, ['--json']);

        expect(result.status).toBe(0);

        const json = JSON.parse(result.stdout.trim());
        expect(json.success).toBe(true);
        expect(json.config.name).toBe('ci');
        expect(json.config.dialect).toBe('postgres');
        expect(json.config.isTest).toBe(true);
        expect(json.identity.source).toBe('env');

        expect(existsSync(join(tmpDir, '.noorm', 'state', 'state.enc'))).toBe(true);

    });

    it('uses --name to override the config name', () => {

        const result = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv() },
            ['--name', 'staging', '--json'],
        );

        expect(result.status).toBe(0);

        const json = JSON.parse(result.stdout.trim());
        expect(json.config.name).toBe('staging');

    });

    it('uses NOORM_CI_CONFIG_NAME when --name is not passed', () => {

        const result = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv(), NOORM_CI_CONFIG_NAME: 'env-name' },
            ['--json'],
        );

        expect(result.status).toBe(0);

        const json = JSON.parse(result.stdout.trim());
        expect(json.config.name).toBe('env-name');

    });

    it('exits 1 when identity env vars are missing', () => {

        const result = runInit(tmpDir, validConnectionEnv());

        expect(result.status).toBe(2);
        expect(result.stderr + result.stdout).toContain('NOORM_IDENTITY_PRIVATE_KEY');

    });

    it('exits 1 when connection dialect is missing', () => {

        const { NOORM_CONNECTION_DIALECT: _drop, ...rest } = validConnectionEnv();

        const result = runInit(tmpDir, { ...validIdentityEnv(), ...rest });

        expect(result.status).toBe(2);
        expect(result.stderr + result.stdout).toContain('NOORM_CONNECTION_DIALECT');

    });

    it('exits 1 when existing state.enc is present without --force', () => {

        const first = runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() });
        expect(first.status).toBe(0);

        const second = runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() });

        expect(second.status).toBe(1);
        expect(second.stderr + second.stdout).toContain('--force');

    });

    it('overwrites existing state.enc when --force is passed', () => {

        const first = runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() });
        expect(first.status).toBe(0);

        const second = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv() },
            ['--force', '--json'],
        );

        expect(second.status).toBe(0);

        const json = JSON.parse(second.stdout.trim());
        expect(json.success).toBe(true);

    });

});

/**
 * `ci init --force` deletes state.enc outright — every config and every
 * config-scoped secret in that project, unrecoverably. The command is aimed at
 * ephemeral CI runners where that is the intent, but nothing stops it running
 * against a real project directory, and there is no backup and no way back.
 */
describe('cli: noorm ci init --force is recoverable', () => {

    let tmpDir: string;
    let stateDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-ci-init-force-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');
        stateDir = join(tmpDir, '.noorm', 'state');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    function backups(): string[] {

        return readdirSync(stateDir).filter((f) => f.startsWith('state.enc.bak-'));

    }

    it('backs up the state it is about to destroy', () => {

        const first = runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() });
        expect(first.status).toBe(0);

        const original = readFileSync(join(stateDir, 'state.enc'));

        const second = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv() },
            ['--force'],
        );

        expect(second.status).toBe(0);

        const found = backups();

        expect(found.length).toBe(1);
        expect(readFileSync(join(stateDir, found[0]!))).toEqual(original);

    });

    it('writes the backup owner-only, since it holds every config secret', () => {

        runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() });
        runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() }, ['--force']);

        const mode = statSync(join(stateDir, backups()[0]!)).mode & 0o777;

        expect(mode & 0o077).toBe(0);

    });

    it('reports where the backup went', () => {

        runInit(tmpDir, { ...validIdentityEnv(), ...validConnectionEnv() });

        const result = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv() },
            ['--force', '--json'],
        );

        const json = JSON.parse(result.stdout.trim());

        expect(json.backedUpTo).toContain('state.enc.bak-');

    });

    it('does not create a backup on a first run with no state', () => {

        const result = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv() },
            ['--force', '--json'],
        );

        expect(result.status).toBe(0);
        expect(backups().length).toBe(0);

    });

});

/**
 * `ci init` hand-built the Config object and wrote it straight to state,
 * skipping `parseConfig`. Env values arrive through a parser that coerces
 * numeric-looking strings, so a database literally named `20240101` was
 * persisted as the NUMBER 20240101 — a shape the config schema forbids, which
 * every later consumer then has to survive.
 */
describe('cli: noorm ci init validates the config it persists', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-ci-init-parse-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('persists a numeric-looking database name as a string', async () => {

        const identity = validIdentityEnv();

        const result = runInit(
            tmpDir,
            {
                ...identity,
                ...validConnectionEnv(),
                NOORM_CONNECTION_DATABASE: '20240101',
            },
            ['--json'],
        );

        expect(result.status).toBe(0);

        const state = new StateManager(tmpDir, {
            privateKey: identity.NOORM_IDENTITY_PRIVATE_KEY,
        });
        await state.load();

        const stored = state.getConfig('ci');

        expect(stored?.connection.database).toBe('20240101');
        expect(typeof stored?.connection.database).toBe('string');

    });

    it('reports the database name as a string in --json', () => {

        const result = runInit(
            tmpDir,
            { ...validIdentityEnv(), ...validConnectionEnv(), NOORM_CONNECTION_DATABASE: '20240101' },
            ['--json'],
        );

        const json = JSON.parse(result.stdout.trim());

        expect(json.config.database).toBe('20240101');

    });

});

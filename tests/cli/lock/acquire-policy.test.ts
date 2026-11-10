/** A role that may not write must be told so in one line, with a failing exit code and no lock taken. */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'lockacquire';
const REFUSAL = `Cannot lock.acquire on config "${CONFIG_NAME}": "lock:acquire" is not allowed on config "${CONFIG_NAME}" (role: viewer).`;

describe('cli: noorm lock acquire policy', () => {

    let tmpDir: string;
    let fakeHome: string;
    let privateKey: string;
    let env: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-lock-acquire-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-lock-acquire-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');
        writeFileSync(join(tmpDir, 'target.db'), '');

        privateKey = generateKeyPair().privateKey;
        env = {
            ...Object.fromEntries(Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('NOORM_'),
            )),
            HOME: fakeHome,
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'CI Bot',
            NOORM_IDENTITY_EMAIL: 'ci@example.com',
        };

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    async function seedConfig(access: ConfigAccess): Promise<void> {

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(CONFIG_NAME, {
            name: CONFIG_NAME,
            type: 'local',
            isTest: false,
            access,
            connection: { dialect: 'sqlite', database: join(tmpDir, 'target.db') },
        });
        await manager.setActiveConfig(CONFIG_NAME);

    }

    function run(...args: string[]) {

        return spawnSync('node', [CLI, ...args], { cwd: tmpDir, encoding: 'utf-8', env });

    }

    it('should refuse a viewer in one line and take no lock', async () => {

        await seedConfig({ user: 'viewer', agent: false });

        const result = run('lock', 'acquire');
        const status = JSON.parse(run('lock', 'status', '--json').stdout);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(REFUSAL);
        expect(result.stderr).not.toContain('    at ');
        expect(status.isLocked).toBe(false);

    });

    it('should report the refusal in the JSON envelope', async () => {

        await seedConfig({ user: 'viewer', agent: false });

        const result = run('lock', 'acquire', '--json');

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout).error).toContain('"lock:acquire" is not allowed');

    });

    it('should refuse a viewer releasing a lock', async () => {

        await seedConfig({ user: 'viewer', agent: false });

        const result = run('lock', 'release');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('"lock:acquire" is not allowed');

    });

    it('should let an operator acquire and release without --yes', async () => {

        await seedConfig({ user: 'operator', agent: 'viewer' });

        expect(run('lock', 'acquire', '--json').status).toBe(0);
        expect(run('lock', 'release', '--json').status).toBe(0);

    });

});

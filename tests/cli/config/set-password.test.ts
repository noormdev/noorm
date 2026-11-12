/** cli: config set-password. Subprocess against dist (the command calls process.exit); state is read back from disk. */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { StateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const CONFIG_NAME = 'prod';
const OLD_PASSWORD = 'old-password';
const NEW_PASSWORD = 'rotated-password-9f3';

describe('cli: noorm config set-password', () => {

    let tmpDir: string;
    let fakeHome: string;
    let privateKey: string;
    let env: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-set-password-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-set-password-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

        privateKey = generateKeyPair().privateKey;

        // Inherited NOORM_* is dropped so an ambient NOORM_YES cannot change a case.
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

    async function seedConfig(name: string, access: ConfigAccess, dialect: 'postgres' | 'sqlite' = 'postgres'): Promise<void> {

        const config: Config = {
            name,
            type: 'local',
            isTest: false,
            access,
            connection: dialect === 'sqlite'
                ? { dialect, database: join(tmpDir, `${name}.db`) }
                : { dialect, host: 'db.example.test', port: 5432, database: 'app', user: 'app', password: OLD_PASSWORD },
        };

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();
        await manager.setConfig(name, config);

    }

    async function storedConfig(name: string): Promise<Config | null> {

        const manager = new StateManager(tmpDir, { privateKey });
        await manager.load();

        return manager.getConfig(name);

    }

    function run(args: string[], input?: string) {

        return spawnSync('node', [CLI, 'config', 'set-password', ...args], {
            cwd: tmpDir, encoding: 'utf-8', env, input,
        });

    }

    it('should store a password read from stdin and leave every other field alone', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = run([CONFIG_NAME, '--stdin', '--yes'], `${NEW_PASSWORD}\n`);
        const config = await storedConfig(CONFIG_NAME);

        expect(result.status).toBe(0);
        expect(config?.connection).toEqual({
            dialect: 'postgres', host: 'db.example.test', port: 5432, database: 'app', user: 'app', password: NEW_PASSWORD,
        });
        expect(config?.access).toEqual({ user: 'admin', agent: 'admin' });

    });

    it('should store a password passed as an argument', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = run([CONFIG_NAME, NEW_PASSWORD, '--yes']);

        expect(result.status).toBe(0);
        expect((await storedConfig(CONFIG_NAME))?.connection.password).toBe(NEW_PASSWORD);

    });

    it('should never print the password, in text or JSON output', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const text = run([CONFIG_NAME, '--stdin', '--yes'], NEW_PASSWORD);
        const json = run([CONFIG_NAME, '--stdin', '--yes', '--json'], NEW_PASSWORD);
        const argv = run([CONFIG_NAME, NEW_PASSWORD, '--yes', '--json']);

        expect(`${text.stdout}${text.stderr}`).not.toContain(NEW_PASSWORD);
        expect(`${json.stdout}${json.stderr}`).not.toContain(NEW_PASSWORD);
        expect(`${argv.stdout}${argv.stderr}`).not.toContain(NEW_PASSWORD);
        expect(JSON.parse(json.stdout)).toMatchObject({ success: true, name: CONFIG_NAME });

    });

    it('should refuse without --yes when the config requires confirmation, leaving the password alone', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = run([CONFIG_NAME, NEW_PASSWORD]);

        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain('Pass --yes to confirm');
        expect((await storedConfig(CONFIG_NAME))?.connection.password).toBe(OLD_PASSWORD);

    });

    it('should refuse a viewer config, leaving the password alone', async () => {

        await seedConfig(CONFIG_NAME, { user: 'viewer', agent: 'viewer' });

        const result = run([CONFIG_NAME, NEW_PASSWORD, '--yes']);

        expect(result.status).toBe(1);
        expect((await storedConfig(CONFIG_NAME))?.connection.password).toBe(OLD_PASSWORD);

    });

    it('should name an unknown config with the usage exit code instead of reporting success', async () => {

        const result = run(['missing', NEW_PASSWORD, '--yes']);

        expect(result.status).toBe(2);
        expect(`${result.stdout}${result.stderr}`).toContain('"missing" not found');

    });

    it('should refuse an empty password so an empty rotation variable cannot wipe the stored one', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = run([CONFIG_NAME, '', '--yes']);
        const piped = run([CONFIG_NAME, '--stdin', '--yes'], '\n');

        expect(result.status).toBe(1);
        expect(piped.status).toBe(1);
        expect((await storedConfig(CONFIG_NAME))?.connection.password).toBe(OLD_PASSWORD);

    });

    it('should refuse on the agent channel even with --yes, leaving the password alone', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'viewer' });

        const result = spawnSync('node', [CLI, 'config', 'set-password', CONFIG_NAME, NEW_PASSWORD, '--yes'], {
            cwd: tmpDir, encoding: 'utf-8', env: { ...env, NOORM_CHANNEL: 'agent' },
        });

        expect(result.status).toBe(1);
        expect((await storedConfig(CONFIG_NAME))?.connection.password).toBe(OLD_PASSWORD);

    });

    it('should refuse a SQLite config, which has no password', async () => {

        await seedConfig('local', { user: 'admin', agent: 'admin' }, 'sqlite');

        const result = run(['local', NEW_PASSWORD, '--yes']);

        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain('no password');
        expect((await storedConfig('local'))?.connection.password).toBeUndefined();

    });

    it('should refuse when neither a value nor --stdin is given', async () => {

        await seedConfig(CONFIG_NAME, { user: 'admin', agent: 'admin' });

        const result = run([CONFIG_NAME, '--yes']);

        expect(result.status).toBe(1);
        expect((await storedConfig(CONFIG_NAME))?.connection.password).toBe(OLD_PASSWORD);

    });

});

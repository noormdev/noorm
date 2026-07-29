/**
 * StateManager tests.
 *
 * Uses a local tmp/ folder with custom state paths to avoid
 * polluting the project directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { StateManager, resetStateManager, getPackageVersion, InvalidSecretKeyError } from '../../../src/core/state/index.js';
import type { Config, Stage } from '../../../src/core/config/types.js';
import { ConfigStageLockedError } from '../../../src/core/config/index.js';
import { SettingsProvider } from '../../../src/core/config/resolver.js';
import type { KnownUser } from '../../../src/core/identity/types.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { encrypt, decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload } from '../../../src/core/state/types.js';
import { guarded } from '../../../src/core/policy/index.js';
import { observer } from '../../../src/core/observer.js';
import { CURRENT_VERSIONS } from '../../../src/core/version/types.js';

/**
 * Create a valid test config.
 */
function createTestConfig(name: string, overrides: Partial<Config> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        ...overrides,
    };

}

/**
 * Create a mock settings provider for testing.
 */
function createMockSettings(stages: Record<string, Stage> = {}): SettingsProvider {

    const mock = {
        getStage(name: string): Stage | null {

            return stages[name] ?? null;

        },
        findStageForConfig(configName: string): Stage | null {

            return stages[configName] ?? null;

        },
    };

    return Object.assign(Object.create(SettingsProvider.prototype), mock);

}

describe('state: manager', () => {

    let tempDir: string;
    let state: StateManager;
    let testPrivateKey: string;

    beforeEach(async () => {

        resetStateManager();
        // Create temp directory in local tmp/ folder
        tempDir = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-test-'));

        // Generate a test private key for encryption
        const keyPair = await generateKeyPair();
        testPrivateKey = keyPair.privateKey;

        state = new StateManager(tempDir, {
            stateDir: '.test-state',
            stateFile: 'state.enc',
            privateKey: testPrivateKey,
        });

    });

    afterEach(() => {

        if (existsSync(tempDir)) {

            rmSync(tempDir, { recursive: true });

        }

    });

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    describe('lifecycle', () => {

        it('should start with empty state when no file exists', async () => {

            await state.load();

            expect(state.listConfigs()).toEqual([]);
            expect(state.getActiveConfig()).toBeNull();
            expect(state.getActiveConfigName()).toBeNull();

        });

        it('should throw if methods called before load()', () => {

            expect(() => state.listConfigs()).toThrow('StateManager not loaded');
            expect(() => state.getConfig('test')).toThrow('StateManager not loaded');
            expect(() => state.getActiveConfig()).toThrow('StateManager not loaded');

        });

        it('should create state file on first persist', async () => {

            await state.load();
            await state.setConfig('test', createTestConfig('test'));

            const statePath = state.getStatePath();
            expect(existsSync(statePath)).toBe(true);

        });

        it('should report exists() correctly', async () => {

            expect(state.exists()).toBe(false);

            await state.load();
            await state.setConfig('test', createTestConfig('test'));

            expect(state.exists()).toBe(true);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Migration (legacy `protected` -> `access`, on real load())
    // ─────────────────────────────────────────────────────────────

    describe('load: legacy protected -> access migration', () => {

        /**
         * Writes a state.enc file shaped like state predating per-config
         * access roles: no `schemaVersion` field (that field didn't exist
         * yet) and configs carrying the legacy `protected` boolean instead
         * of `access`.
         */
        function writeLegacyState(
            statePath: string,
            privateKey: string,
            configs: Record<string, unknown>,
        ): void {

            const legacyState = {
                version: '1.0.0',
                knownUsers: {},
                activeConfig: null,
                configs,
                secrets: {},
                globalSecrets: {},
            };

            mkdirSync(dirname(statePath), { recursive: true });
            writeFileSync(
                statePath,
                JSON.stringify(encrypt(JSON.stringify(legacyState), privateKey), null, 2),
            );

        }

        it('should migrate a legacy protected:true config to guarded access', async () => {

            const statePath = state.getStatePath();
            writeLegacyState(statePath, testPrivateKey, {
                prod: {
                    name: 'prod',
                    type: 'local',
                    isTest: false,
                    protected: true,
                    connection: { dialect: 'sqlite', database: ':memory:' },
                },
            });

            await state.load();

            expect(state.getConfig('prod')?.access).toEqual({ user: 'operator', mcp: 'viewer' });

            const raw = readFileSync(statePath, 'utf8');
            const decrypted = JSON.parse(
                decrypt(JSON.parse(raw) as EncryptedPayload, testPrivateKey),
            ) as { schemaVersion: number; configs: Record<string, Record<string, unknown>> };

            expect(decrypted.schemaVersion).toBe(CURRENT_VERSIONS.state);
            expect(decrypted.configs['prod']).not.toHaveProperty('protected');

        });

        it('should migrate a legacy protected:false config to open access', async () => {

            const statePath = state.getStatePath();
            writeLegacyState(statePath, testPrivateKey, {
                dev: {
                    name: 'dev',
                    type: 'local',
                    isTest: false,
                    protected: false,
                    connection: { dialect: 'sqlite', database: ':memory:' },
                },
            });

            await state.load();

            expect(state.getConfig('dev')?.access).toEqual({ user: 'admin', mcp: 'admin' });

            const raw = readFileSync(statePath, 'utf8');
            const decrypted = JSON.parse(
                decrypt(JSON.parse(raw) as EncryptedPayload, testPrivateKey),
            ) as { schemaVersion: number; configs: Record<string, Record<string, unknown>> };

            expect(decrypted.schemaVersion).toBe(CURRENT_VERSIONS.state);
            expect(decrypted.configs['dev']).not.toHaveProperty('protected');

        });

        it('should persist a backfilled access to disk even when no version migration ran', async () => {

            const statePath = state.getStatePath();
            const currentVersion = getPackageVersion();

            const currentState = {
                version: currentVersion,
                schemaVersion: CURRENT_VERSIONS.state,
                identity: {},
                knownUsers: {},
                activeConfig: null,
                configs: {
                    corrupt: {
                        name: 'corrupt',
                        type: 'local',
                        isTest: false,
                        connection: { dialect: 'sqlite', database: ':memory:' },
                    },
                },
                secrets: {},
                globalSecrets: {},
            };

            mkdirSync(dirname(statePath), { recursive: true });
            writeFileSync(
                statePath,
                JSON.stringify(encrypt(JSON.stringify(currentState), testPrivateKey), null, 2),
            );

            await state.load();

            expect(state.getConfig('corrupt')?.access).toEqual({ user: 'admin', mcp: 'admin' });

            const raw = readFileSync(statePath, 'utf8');
            const decrypted = JSON.parse(
                decrypt(JSON.parse(raw) as EncryptedPayload, testPrivateKey),
            ) as { configs: Record<string, Record<string, unknown>> };

            expect(decrypted.configs['corrupt']?.['access']).toEqual({
                user: 'admin',
                mcp: 'admin',
            });

        });

        it('should backfill a legacy protected:true config at current schemaVersion to guarded access', async () => {

            // Reproduces a config that reached the current schemaVersion carrying
            // the legacy `protected` boolean without `access` — e.g. saved
            // directly via setConfig, bypassing ConfigSchema (the CLI `config
            // import` bug this guards against). The schema-version migration
            // is a no-op at current version, so this raw shape survives
            // unchanged into the backfill loop; it must resolve per the
            // documented fail-closed mapping (protected:true -> operator/viewer),
            // not the admin/admin open-access fallback.
            const statePath = state.getStatePath();
            const currentVersion = getPackageVersion();

            const currentState = {
                version: currentVersion,
                schemaVersion: CURRENT_VERSIONS.state,
                identity: {},
                knownUsers: {},
                activeConfig: null,
                configs: {
                    guarded: {
                        name: 'guarded',
                        type: 'local',
                        isTest: false,
                        protected: true,
                        connection: { dialect: 'sqlite', database: ':memory:' },
                    },
                },
                secrets: {},
                globalSecrets: {},
            };

            mkdirSync(dirname(statePath), { recursive: true });
            writeFileSync(
                statePath,
                JSON.stringify(encrypt(JSON.stringify(currentState), testPrivateKey), null, 2),
            );

            await state.load();

            expect(state.getConfig('guarded')?.access).toEqual({ user: 'operator', mcp: 'viewer' });

            const raw = readFileSync(statePath, 'utf8');
            const decrypted = JSON.parse(
                decrypt(JSON.parse(raw) as EncryptedPayload, testPrivateKey),
            ) as { configs: Record<string, Record<string, unknown>> };

            expect(decrypted.configs['guarded']?.['access']).toEqual({
                user: 'operator',
                mcp: 'viewer',
            });

        });

        it('should leave state.enc byte-identical when there is nothing to migrate', async () => {

            // A load with no migration and no backfill must not write. When
            // it does, every read-only command (`version`, `secret list`,
            // `db explore`) becomes a full re-encrypt and rewrite, which
            // both amplifies the window for a concurrent-write conflict and
            // makes `state:persisted` meaningless as a change signal.
            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));

            const statePath = state.getStatePath();
            const before = readFileSync(statePath, 'utf8');

            const reader = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state.enc',
                privateKey: testPrivateKey,
            });
            await reader.load();

            expect(readFileSync(statePath, 'utf8')).toBe(before);

        });

        it('should not emit state:persisted on a load with nothing to migrate', async () => {

            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));

            const persisted: unknown[] = [];
            const off = observer.on('state:persisted', (data) => persisted.push(data));

            const reader = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state.enc',
                privateKey: testPrivateKey,
            });
            await reader.load();
            off();

            expect(persisted).toHaveLength(0);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Config Operations
    // ─────────────────────────────────────────────────────────────

    describe('config operations', () => {

        beforeEach(async () => {

            await state.load();

        });

        it('should create and retrieve a config', async () => {

            const config = createTestConfig('dev');
            await state.setConfig('dev', config);

            const retrieved = state.getConfig('dev');
            expect(retrieved).toEqual(config);

        });

        it('should return null for non-existent config', () => {

            const config = state.getConfig('nonexistent');
            expect(config).toBeNull();

        });

        it('should update existing config', async () => {

            await state.setConfig('dev', createTestConfig('dev'));
            await state.setConfig('dev', createTestConfig('dev', { access: { user: 'operator', mcp: 'viewer' } }));

            const config = state.getConfig('dev');
            expect(guarded(config!)).toBe(true);

        });

        it('should delete a config', async () => {

            await state.setConfig('dev', createTestConfig('dev'));
            await state.deleteConfig('dev');

            expect(state.getConfig('dev')).toBeNull();

        });

        it('should list all configs', async () => {

            // Start with known clean state
            const initialCount = state.listConfigs().length;

            await state.setConfig('dev', createTestConfig('dev'));
            await state.setConfig('prod', createTestConfig('prod', { access: { user: 'operator', mcp: 'viewer' } }));

            const list = state.listConfigs();
            expect(list).toHaveLength(initialCount + 2);
            expect(list.find((c) => c.name === 'dev')).toBeDefined();
            expect(guarded(list.find((c) => c.name === 'prod')!)).toBe(true);

        });

        it('should include access in config summaries', async () => {

            await state.setConfig('dev', createTestConfig('dev'));
            await state.setConfig('prod', createTestConfig('prod', { access: { user: 'operator', mcp: 'viewer' } }));

            const list = state.listConfigs();

            expect(list.find((c) => c.name === 'dev')?.access).toEqual({
                user: 'admin',
                mcp: 'admin',
            });
            expect(list.find((c) => c.name === 'prod')?.access).toEqual({
                user: 'operator',
                mcp: 'viewer',
            });

        });

        it('should not persist a stored protected field on disk', async () => {

            await state.setConfig('dev', createTestConfig('dev', { access: { user: 'operator', mcp: 'viewer' } }));

            const raw = readFileSync(state.getStatePath(), 'utf8');
            const payload = JSON.parse(raw) as EncryptedPayload;
            const decrypted = JSON.parse(decrypt(payload, testPrivateKey)) as {
                configs: Record<string, Record<string, unknown>>;
            };

            expect(decrypted.configs['dev']).not.toHaveProperty('protected');
            expect(decrypted.configs['dev']?.['access']).toEqual({
                user: 'operator',
                mcp: 'viewer',
            });

        });

        it('should set and get active config', async () => {

            await state.setConfig('dev', createTestConfig('dev'));
            await state.setActiveConfig('dev');

            expect(state.getActiveConfigName()).toBe('dev');
            expect(state.getActiveConfig()?.name).toBe('dev');

        });

        it('should throw when setting non-existent config as active', async () => {

            await expect(state.setActiveConfig('nonexistent')).rejects.toThrow('does not exist');

        });

        it('should clear active config when deleted', async () => {

            await state.setConfig('dev', createTestConfig('dev'));
            await state.setActiveConfig('dev');
            await state.deleteConfig('dev');

            expect(state.getActiveConfigName()).toBeNull();

        });

        describe('deleteConfig: locked stage guard', () => {

            it('should throw ConfigStageLockedError naming the stage when linked to a locked stage', async () => {

                await state.setConfig('prod', createTestConfig('prod'));
                const settings = createMockSettings({ prod: { locked: true } });

                await expect(state.deleteConfig('prod', settings)).rejects.toThrow(
                    ConfigStageLockedError,
                );
                await expect(state.deleteConfig('prod', settings)).rejects.toThrow('prod');
                expect(state.getConfig('prod')).not.toBeNull();

            });

            it('should delete cleanly when linked to an unlocked stage', async () => {

                await state.setConfig('dev', createTestConfig('dev'));
                const settings = createMockSettings({ dev: { locked: false } });

                await state.deleteConfig('dev', settings);

                expect(state.getConfig('dev')).toBeNull();

            });

            it('should delete cleanly when no settings provider is given', async () => {

                await state.setConfig('staging', createTestConfig('staging'));

                await state.deleteConfig('staging');

                expect(state.getConfig('staging')).toBeNull();

            });

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Secret Operations
    // ─────────────────────────────────────────────────────────────

    describe('secret operations', () => {

        beforeEach(async () => {

            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));

        });

        it('should set and get a secret', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret-value');

            const secret = state.getSecret('dev', 'API_KEY');
            expect(secret).toBe('secret-value');

        });

        it('should return null for non-existent secret', () => {

            const secret = state.getSecret('dev', 'NONEXISTENT');
            expect(secret).toBeNull();

        });

        it('should throw when setting secret on non-existent config', async () => {

            await expect(state.setSecret('nonexistent', 'KEY', 'value')).rejects.toThrow(
                'does not exist',
            );

        });

        it('should reject a key with spaces', async () => {

            await expect(state.setSecret('dev', 'key with spaces', 'v')).rejects.toThrow(
                InvalidSecretKeyError,
            );

        });

        it('should reject a key starting with a digit', async () => {

            await expect(state.setSecret('dev', '1abc', 'v')).rejects.toThrow(
                InvalidSecretKeyError,
            );

        });

        it('should reject a key with a hyphen', async () => {

            await expect(state.setSecret('dev', 'a-b', 'v')).rejects.toThrow(
                InvalidSecretKeyError,
            );

        });

        it('should accept valid keys', async () => {

            await expect(state.setSecret('dev', 'API_KEY', 'v')).resolves.toBeUndefined();
            await expect(state.setSecret('dev', 'db_password', 'v')).resolves.toBeUndefined();

        });

        it('should list secret keys without values', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret1');
            await state.setSecret('dev', 'DB_PASSWORD', 'secret2');

            const keys = state.listSecrets('dev');
            expect(keys).toContain('API_KEY');
            expect(keys).toContain('DB_PASSWORD');
            expect(keys).not.toContain('secret1');

        });

        it('should get all secrets for a config', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret1');
            await state.setSecret('dev', 'DB_PASSWORD', 'secret2');

            const secrets = state.getAllSecrets('dev');
            expect(secrets).toEqual({
                API_KEY: 'secret1',
                DB_PASSWORD: 'secret2',
            });

        });

        it('should delete a secret', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret-value');
            await state.deleteSecret('dev', 'API_KEY');

            expect(state.getSecret('dev', 'API_KEY')).toBeNull();

        });

        it('should delete secrets when config is deleted', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret-value');
            await state.deleteConfig('dev');

            // Re-create config to check secrets are gone
            await state.setConfig('dev', createTestConfig('dev'));
            expect(state.getSecret('dev', 'API_KEY')).toBeNull();

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────

    describe('persistence', () => {

        it('should persist and reload state', async () => {

            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));
            await state.setActiveConfig('dev');
            await state.setSecret('dev', 'API_KEY', 'test-secret');

            // Create new instance pointing to same location with same key
            const state2 = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state.enc',
                privateKey: testPrivateKey,
            });
            await state2.load();

            expect(state2.getConfig('dev')?.name).toBe('dev');
            expect(state2.getActiveConfigName()).toBe('dev');
            expect(state2.getSecret('dev', 'API_KEY')).toBe('test-secret');

        });

        it('should work with private key encryption', async () => {

            const keyPair = await generateKeyPair();

            const stateWithKey = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-identity.enc',
                privateKey: keyPair.privateKey,
            });
            await stateWithKey.load();
            await stateWithKey.setConfig('dev', createTestConfig('dev'));
            await stateWithKey.setSecret('dev', 'API_KEY', 'secret-value');

            // Same private key should work
            const state2 = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-identity.enc',
                privateKey: keyPair.privateKey,
            });
            await state2.load();

            expect(state2.getConfig('dev')?.name).toBe('dev');
            expect(state2.getSecret('dev', 'API_KEY')).toBe('secret-value');

        });

        it('should fail with wrong private key', async () => {

            const keyPair1 = await generateKeyPair();
            const keyPair2 = await generateKeyPair();

            const stateWithKey = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-identity2.enc',
                privateKey: keyPair1.privateKey,
            });
            await stateWithKey.load();
            await stateWithKey.setConfig('dev', createTestConfig('dev'));

            // Different private key should fail
            const wrongState = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-identity2.enc',
                privateKey: keyPair2.privateKey,
            });
            await expect(wrongState.load()).rejects.toThrow('Failed to decrypt');

        });

        it('should report hasPrivateKey correctly', async () => {

            const keyPair = await generateKeyPair();

            // State without private key
            const stateNoKey = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-no-key.enc',
            });
            expect(stateNoKey.hasPrivateKey()).toBe(false);

            // State with private key
            const stateWithKey = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-key-check.enc',
                privateKey: keyPair.privateKey,
            });
            expect(stateWithKey.hasPrivateKey()).toBe(true);

        });

        it('should allow setting private key after construction', async () => {

            const keyPair = await generateKeyPair();

            // Create state without private key (new empty state)
            const initialState = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-upgrade.enc',
            });
            await initialState.load();

            // Set private key after construction
            initialState.setPrivateKey(keyPair.privateKey);
            expect(initialState.hasPrivateKey()).toBe(true);

            // Now we can persist
            await initialState.setConfig('dev', createTestConfig('dev'));

            // Reload with same key
            const state2 = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-upgrade.enc',
                privateKey: keyPair.privateKey,
            });
            await state2.load();
            expect(state2.getConfig('dev')?.name).toBe('dev');

        });

        it('should write statePath at mode 0600 after a persisting operation', async () => {

            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));

            const stat = statSync(state.getStatePath());
            expect(stat.mode & 0o777).toBe(0o600);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Identity Operations
    // ─────────────────────────────────────────────────────────────

    // Note: Identity is now stored globally in ~/.noorm/, not in project state.
    // Identity-related tests have been moved to tests/core/identity/.

    // ─────────────────────────────────────────────────────────────
    // Known Users Operations
    // ─────────────────────────────────────────────────────────────

    describe('known users operations', () => {

        beforeEach(async () => {

            await state.load();

        });

        it('should start with no known users', () => {

            const users = state.getKnownUsers();
            expect(Object.keys(users)).toHaveLength(0);

        });

        it('should add and get a known user', async () => {

            const user: KnownUser = {
                identityHash: 'user-hash-1',
                name: 'Alice',
                email: 'alice@example.com',
                publicKey: 'alice-public-key',
                source: 'db-sync',
                machine: 'test-machine',
                os: 'test-os',
                lastSeen: new Date().toISOString(),
            };

            await state.addKnownUser(user);

            const retrieved = state.getKnownUser('user-hash-1');
            expect(retrieved).toEqual(user);

        });

        it('should return null for unknown user', () => {

            const user = state.getKnownUser('nonexistent-hash');
            expect(user).toBeNull();

        });

        it('should find users by email', async () => {

            const user1: KnownUser = {
                identityHash: 'user-hash-1',
                name: 'Alice (Laptop)',
                email: 'alice@example.com',
                publicKey: 'alice-laptop-key',
                source: 'db-sync',
                machine: 'test-machine',
                os: 'test-os',
                lastSeen: new Date().toISOString(),
            };
            const user2: KnownUser = {
                identityHash: 'user-hash-2',
                name: 'Alice (Desktop)',
                email: 'alice@example.com',
                publicKey: 'alice-desktop-key',
                source: 'db-sync',
                machine: 'test-machine',
                os: 'test-os',
                lastSeen: new Date().toISOString(),
            };
            const user3: KnownUser = {
                identityHash: 'user-hash-3',
                name: 'Bob',
                email: 'bob@example.com',
                publicKey: 'bob-key',
                source: 'db-sync',
                machine: 'test-machine',
                os: 'test-os',
                lastSeen: new Date().toISOString(),
            };

            await state.addKnownUser(user1);
            await state.addKnownUser(user2);
            await state.addKnownUser(user3);

            const aliceUsers = state.findKnownUsersByEmail('alice@example.com');
            expect(aliceUsers).toHaveLength(2);
            expect(aliceUsers.map((u) => u.identityHash).sort()).toEqual([
                'user-hash-1',
                'user-hash-2',
            ]);

        });

        it('should add multiple users in batch', async () => {

            const users: KnownUser[] = [
                {
                    identityHash: 'batch-1',
                    name: 'User 1',
                    email: 'user1@example.com',
                    publicKey: 'key1',
                    source: 'db-sync',
                    machine: 'test-machine',
                    os: 'test-os',
                    lastSeen: new Date().toISOString(),
                },
                {
                    identityHash: 'batch-2',
                    name: 'User 2',
                    email: 'user2@example.com',
                    publicKey: 'key2',
                    source: 'db-sync',
                    machine: 'test-machine',
                    os: 'test-os',
                    lastSeen: new Date().toISOString(),
                },
            ];

            await state.addKnownUsers(users);

            const allUsers = state.getKnownUsers();
            expect(Object.keys(allUsers)).toHaveLength(2);
            expect(state.getKnownUser('batch-1')?.name).toBe('User 1');
            expect(state.getKnownUser('batch-2')?.name).toBe('User 2');

        });

        it('should persist known users across reloads', async () => {

            const user: KnownUser = {
                identityHash: 'persist-user',
                name: 'Persistent',
                email: 'persist@example.com',
                publicKey: 'persist-key',
                source: 'manual',
                machine: 'test-machine',
                os: 'test-os',
                lastSeen: new Date().toISOString(),
            };

            await state.addKnownUser(user);

            // Create new instance and reload with same key
            const state2 = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state.enc',
                privateKey: testPrivateKey,
            });
            await state2.load();

            const retrieved = state2.getKnownUser('persist-user');
            expect(retrieved?.email).toBe('persist@example.com');

        });

        it('should update existing known user', async () => {

            const user: KnownUser = {
                identityHash: 'update-user',
                name: 'Original Name',
                email: 'update@example.com',
                publicKey: 'key1',
                source: 'db-sync',
                machine: 'test-machine',
                os: 'test-os',
                lastSeen: new Date().toISOString(),
            };

            await state.addKnownUser(user);

            // Update with new name
            const updatedUser: KnownUser = {
                ...user,
                name: 'Updated Name',
            };
            await state.addKnownUser(updatedUser);

            const retrieved = state.getKnownUser('update-user');
            expect(retrieved?.name).toBe('Updated Name');

            // Should still be only one user with this hash
            const allUsers = state.getKnownUsers();
            expect(Object.keys(allUsers)).toHaveLength(1);

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Import/Export
    // ─────────────────────────────────────────────────────────────

    describe('import/export', () => {

        it('should export encrypted state', async () => {

            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));

            const exported = state.exportEncrypted();
            expect(exported).not.toBeNull();
            expect(typeof exported).toBe('string');

            // Should be valid JSON with encryption fields
            const parsed = JSON.parse(exported!);
            expect(parsed.algorithm).toBe('aes-256-gcm');
            expect(parsed.iv).toBeDefined();
            expect(parsed.authTag).toBeDefined();
            expect(parsed.ciphertext).toBeDefined();

        });

        it('should return null when exporting non-existent state', async () => {

            const exported = state.exportEncrypted();
            expect(exported).toBeNull();

        });

        it('should import encrypted state', async () => {

            // Create and export state
            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));
            const exported = state.exportEncrypted()!;

            // Create new state with same key and import
            const newState = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'imported.enc',
                privateKey: testPrivateKey,
            });
            await newState.importEncrypted(exported);

            expect(newState.getConfig('dev')?.name).toBe('dev');

        });

        it('should write statePath at mode 0600 after importEncrypted', async () => {

            await state.load();
            await state.setConfig('dev', createTestConfig('dev'));
            const exported = state.exportEncrypted()!;

            const newState = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'imported-mode.enc',
                privateKey: testPrivateKey,
            });
            await newState.importEncrypted(exported);

            const stat = statSync(newState.getStatePath());
            expect(stat.mode & 0o777).toBe(0o600);

        });

    });

});

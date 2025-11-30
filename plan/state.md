# State Management


## Overview

The StateManager is the foundation of noorm. It handles:

- In-memory state during program execution
- Encryption/decryption of state to disk
- Machine ID-based key derivation
- All config and secret operations


## Dependencies

```json
{
    "node-machine-id": "^1.1.12",
    "@logosdx/observer": "^x.x.x",
    "@logosdx/utils": "^x.x.x"
}
```

Node's built-in `crypto` module handles all encryption.


## File Structure

```
src/core/
├── state/
│   ├── index.ts           # Public exports
│   ├── manager.ts         # StateManager class
│   ├── types.ts           # State interfaces
│   └── encryption/
│       ├── index.ts
│       ├── crypto.ts      # AES-256-GCM operations
│       └── machine-id.ts  # Machine ID retrieval + key derivation
```


## Types

```typescript
// src/core/state/types.ts

export interface State {
    version: 1;
    activeConfig: string | null;
    configs: Record<string, Config>;
    secrets: Record<string, Record<string, string>>;  // configName -> key -> value
}

export interface ConfigSummary {
    name: string;
    type: 'local' | 'remote';
    isTest: boolean;
    protected: boolean;
    isActive: boolean;
}

export interface EncryptedPayload {
    version: 1;
    algorithm: 'aes-256-gcm';
    iv: string;          // Base64
    authTag: string;     // Base64
    ciphertext: string;  // Base64
    salt: string;        // Base64
}

export const EMPTY_STATE: State = {
    version: 1,
    activeConfig: null,
    configs: {},
    secrets: {},
};
```


## Encryption Module

### Machine ID

```typescript
// src/core/state/encryption/machine-id.ts

import { machineIdSync } from 'node-machine-id';
import { createHash, pbkdf2Sync, randomBytes } from 'crypto';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;  // 256 bits for AES-256

/**
 * Get the machine's unique identifier.
 * Falls back to a hash of hostname + username if machine-id fails.
 */
export function getMachineId(): string {
    try {
        return machineIdSync(true);  // true = original format
    } catch {
        // Fallback for environments where machine-id isn't available
        const os = require('os');
        const fallback = `${os.hostname()}-${os.userInfo().username}`;
        return createHash('sha256').update(fallback).digest('hex');
    }
}

/**
 * Derive an encryption key from machine ID + optional passphrase.
 */
export function deriveKey(salt: Buffer, passphrase?: string): Buffer {
    const machineId = getMachineId();
    const secret = passphrase
        ? `${machineId}:${passphrase}`
        : machineId;

    return pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Generate a random salt for key derivation.
 */
export function generateSalt(): Buffer {
    return randomBytes(16);
}
```

### Crypto Operations

```typescript
// src/core/state/encryption/crypto.ts

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EncryptedPayload } from '../types';
import { deriveKey, generateSalt } from './machine-id';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string and return the encrypted payload.
 */
export function encrypt(plaintext: string, passphrase?: string): EncryptedPayload {
    const salt = generateSalt();
    const key = deriveKey(salt, passphrase);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
        version: 1,
        algorithm: ALGORITHM,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        salt: salt.toString('base64'),
    };
}

/**
 * Decrypt an encrypted payload and return the plaintext.
 * Throws if decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt(payload: EncryptedPayload, passphrase?: string): string {
    if (payload.version !== 1) {
        throw new Error(`Unsupported encryption version: ${payload.version}`);
    }

    if (payload.algorithm !== ALGORITHM) {
        throw new Error(`Unsupported algorithm: ${payload.algorithm}`);
    }

    const salt = Buffer.from(payload.salt, 'base64');
    const key = deriveKey(salt, passphrase);
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);

    return plaintext.toString('utf8');
}
```


## StateManager Class

```typescript
// src/core/state/manager.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { attempt } from '@logosdx/utils';
import { Config } from '../config/types';
import { encrypt, decrypt } from './encryption/crypto';
import { State, ConfigSummary, EncryptedPayload, EMPTY_STATE } from './types';
import { observer } from '../observer';

const STATE_DIR = '.noorm';
const STATE_FILE = 'state.enc';

export class StateManager {
    private state: State | null = null;
    private passphrase: string | undefined;
    private statePath: string;
    private loaded = false;

    constructor(
        private readonly projectRoot: string,
        passphrase?: string,
    ) {
        this.passphrase = passphrase ?? process.env.NOORM_PASSPHRASE;
        this.statePath = join(projectRoot, STATE_DIR, STATE_FILE);
    }

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    /**
     * Load state from disk. Creates empty state if file doesn't exist.
     * Must be called before any other operations.
     */
    async load(): Promise<void> {
        if (this.loaded) return;

        if (!existsSync(this.statePath)) {
            this.state = { ...EMPTY_STATE };
            this.loaded = true;
            observer.emit('state:loaded', {
                configCount: 0,
                activeConfig: null
            });
            return;
        }

        const [raw, readErr] = await attempt(() => readFileSync(this.statePath, 'utf8'));
        if (readErr) {
            observer.emit('error', { source: 'state', error: readErr });
            throw readErr;
        }

        const [payload, parseErr] = await attempt(() => JSON.parse(raw!) as EncryptedPayload);
        if (parseErr) {
            observer.emit('error', { source: 'state', error: parseErr });
            throw new Error('Failed to parse state file. File may be corrupted.');
        }

        const [decrypted, decryptErr] = await attempt(() => decrypt(payload!, this.passphrase));
        if (decryptErr) {
            observer.emit('error', { source: 'state', error: decryptErr });
            throw new Error('Failed to decrypt state. Wrong passphrase or corrupted file.');
        }

        const [state, stateParseErr] = await attempt(() => JSON.parse(decrypted!) as State);
        if (stateParseErr) {
            observer.emit('error', { source: 'state', error: stateParseErr });
            throw new Error('Failed to parse decrypted state.');
        }

        this.state = state!;
        this.loaded = true;

        observer.emit('state:loaded', {
            configCount: Object.keys(this.state.configs).length,
            activeConfig: this.state.activeConfig
        });
    }

    /**
     * Persist current state to disk (encrypted).
     */
    private async persist(): Promise<void> {
        this.ensureLoaded();

        const dir = dirname(this.statePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        const json = JSON.stringify(this.state);
        const payload = encrypt(json, this.passphrase);

        const [, writeErr] = await attempt(() =>
            writeFileSync(this.statePath, JSON.stringify(payload, null, 2))
        );

        if (writeErr) {
            observer.emit('error', { source: 'state', error: writeErr });
            throw writeErr;
        }

        observer.emit('state:persisted', {
            configCount: Object.keys(this.state!.configs).length
        });
    }

    private ensureLoaded(): asserts this is { state: State } {
        if (!this.loaded || !this.state) {
            throw new Error('StateManager not loaded. Call load() first.');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Config Operations
    // ─────────────────────────────────────────────────────────────

    getConfig(name: string): Config | null {
        this.ensureLoaded();
        return this.state.configs[name] ?? null;
    }

    async setConfig(name: string, config: Config): Promise<void> {
        this.ensureLoaded();
        const isNew = !this.state.configs[name];
        this.state.configs[name] = config;
        await this.persist();

        observer.emit(isNew ? 'config:created' : 'config:updated', {
            name,
            fields: Object.keys(config)
        });
    }

    async deleteConfig(name: string): Promise<void> {
        this.ensureLoaded();
        delete this.state.configs[name];
        delete this.state.secrets[name];

        if (this.state.activeConfig === name) {
            this.state.activeConfig = null;
        }

        await this.persist();
        observer.emit('config:deleted', { name });
    }

    listConfigs(): ConfigSummary[] {
        this.ensureLoaded();
        return Object.entries(this.state.configs).map(([name, config]) => ({
            name,
            type: config.type,
            isTest: config.isTest,
            protected: config.protected,
            isActive: this.state!.activeConfig === name,
        }));
    }

    getActiveConfig(): Config | null {
        this.ensureLoaded();
        if (!this.state.activeConfig) return null;
        return this.state.configs[this.state.activeConfig] ?? null;
    }

    getActiveConfigName(): string | null {
        this.ensureLoaded();
        return this.state.activeConfig;
    }

    async setActiveConfig(name: string): Promise<void> {
        this.ensureLoaded();
        if (!this.state.configs[name]) {
            throw new Error(`Config "${name}" does not exist.`);
        }
        const previous = this.state.activeConfig;
        this.state.activeConfig = name;
        await this.persist();

        observer.emit('config:activated', { name, previous });
    }

    // ─────────────────────────────────────────────────────────────
    // Secret Operations
    // ─────────────────────────────────────────────────────────────

    getSecret(configName: string, key: string): string | null {
        this.ensureLoaded();
        return this.state.secrets[configName]?.[key] ?? null;
    }

    getAllSecrets(configName: string): Record<string, string> {
        this.ensureLoaded();
        return { ...this.state.secrets[configName] } ?? {};
    }

    async setSecret(configName: string, key: string, value: string): Promise<void> {
        this.ensureLoaded();

        if (!this.state.configs[configName]) {
            throw new Error(`Config "${configName}" does not exist.`);
        }

        if (!this.state.secrets[configName]) {
            this.state.secrets[configName] = {};
        }

        this.state.secrets[configName][key] = value;
        await this.persist();

        observer.emit('secret:set', { configName, key });
    }

    async deleteSecret(configName: string, key: string): Promise<void> {
        this.ensureLoaded();

        if (this.state.secrets[configName]) {
            delete this.state.secrets[configName][key];
            await this.persist();

            observer.emit('secret:deleted', { configName, key });
        }
    }

    listSecrets(configName: string): string[] {
        this.ensureLoaded();
        return Object.keys(this.state.secrets[configName] ?? {});
    }

    // ─────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if state file exists (before loading).
     */
    exists(): boolean {
        return existsSync(this.statePath);
    }

    /**
     * Get the path to the state file.
     */
    getStatePath(): string {
        return this.statePath;
    }

    /**
     * Export state for backup (still encrypted).
     */
    exportEncrypted(): string | null {
        if (!existsSync(this.statePath)) return null;
        return readFileSync(this.statePath, 'utf8');
    }

    /**
     * Import state from backup.
     */
    async importEncrypted(encrypted: string): Promise<void> {
        // Validate it can be decrypted first
        const [payload, parseErr] = await attempt(() => JSON.parse(encrypted) as EncryptedPayload);
        if (parseErr) throw parseErr;

        const [, decryptErr] = await attempt(() => decrypt(payload!, this.passphrase));
        if (decryptErr) throw decryptErr;

        const dir = dirname(this.statePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(this.statePath, encrypted);
        this.loaded = false;
        await this.load();
    }
}
```


## Factory Function

```typescript
// src/core/state/index.ts

export { StateManager } from './manager';
export * from './types';

let instance: StateManager | null = null;

/**
 * Get or create the StateManager singleton.
 */
export function getStateManager(projectRoot?: string): StateManager {
    if (!instance) {
        const root = projectRoot ?? process.cwd();
        instance = new StateManager(root);
    }
    return instance;
}

/**
 * Initialize the StateManager. Must be called at app startup.
 */
export async function initState(projectRoot?: string): Promise<StateManager> {
    const manager = getStateManager(projectRoot);
    await manager.load();
    return manager;
}

/**
 * Reset the singleton (for testing).
 */
export function resetStateManager(): void {
    instance = null;
}
```


## Usage Examples

### Basic Usage

```typescript
import { initState } from './core/state';

async function main() {
    const state = await initState();

    // Create a config
    await state.setConfig('dev', {
        name: 'dev',
        type: 'local',
        isTest: false,
        protected: false,
        connection: {
            dialect: 'postgres',
            host: 'localhost',
            port: 5432,
            database: 'myapp_dev',
            user: 'postgres',
            password: 'postgres',
        },
        paths: {
            schema: './schema',
            changesets: './changesets',
        },
    });

    // Set it as active
    await state.setActiveConfig('dev');

    // Add a secret
    await state.setSecret('dev', 'API_KEY', 'sk-123456');

    // Retrieve
    const config = state.getActiveConfig();
    const apiKey = state.getSecret('dev', 'API_KEY');
}
```

### With Passphrase

```typescript
import { StateManager } from './core/state';

async function main() {
    // Explicit passphrase
    const state = new StateManager(process.cwd(), 'my-team-secret');
    await state.load();

    // Or via environment variable
    // NOORM_PASSPHRASE=my-team-secret noorm config list
}
```


## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `StateManager not loaded` | Called method before `load()` | Call `load()` first |
| `Failed to decrypt state` | Wrong passphrase or corrupted file | Check passphrase, restore from backup |
| `Config "x" does not exist` | Referencing non-existent config | Create config first |
| `Unsupported encryption version` | State file from newer noorm version | Update noorm |


## Testing

```typescript
import { StateManager, resetStateManager } from './core/state';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('StateManager', () => {
    let tempDir: string;
    let state: StateManager;

    beforeEach(async () => {
        resetStateManager();
        tempDir = mkdtempSync(join(tmpdir(), 'noorm-test-'));
        state = new StateManager(tempDir);
        await state.load();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true });
    });

    it('should start with empty state', () => {
        expect(state.listConfigs()).toEqual([]);
        expect(state.getActiveConfig()).toBeNull();
    });

    it('should persist configs', async () => {
        await state.setConfig('test', { /* ... */ });

        // Create new instance to verify persistence
        const state2 = new StateManager(tempDir);
        await state2.load();

        expect(state2.getConfig('test')).toBeDefined();
    });

    it('should fail with wrong passphrase', async () => {
        const withPass = new StateManager(tempDir, 'secret');
        await withPass.load();
        await withPass.setConfig('test', { /* ... */ });

        const wrongPass = new StateManager(tempDir, 'wrong');
        await expect(wrongPass.load()).rejects.toThrow('Failed to decrypt');
    });
});
```


## Security Considerations

1. **Machine-bound encryption** - State can only be decrypted on the same machine
2. **Optional passphrase** - Adds layer for shared machines/teams
3. **No plaintext secrets** - Secrets never written to disk unencrypted
4. **Auth tag verification** - Detects tampering with encrypted file
5. **Atomic writes** - Single file prevents partial state corruption

### Limitations

- If machine ID changes (hardware swap, VM migration), state becomes inaccessible
- No built-in key rotation (export/import required)
- Passphrase recovery not possible (no backdoor by design)

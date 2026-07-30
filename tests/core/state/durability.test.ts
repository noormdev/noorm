/**
 * State durability tests: concurrency, atomicity, backup, corruption.
 *
 * state.enc holds every config, every secret and every DB password in a
 * project, and it is rewritten as a whole file on every mutation. These
 * tests cover what happens when that write races another writer, when it
 * fails part-way, and when the file on disk is damaged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, chmodSync, utimesSync } from 'fs';
import { join, dirname } from 'path';
import { attempt } from '@logosdx/utils';
import { StateManager, resetStateManager } from '../../../src/core/state/index.js';
import type { Config } from '../../../src/core/config/types.js';
import { generateKeyPair } from '../../../src/core/identity/crypto.js';

const STATE_DIR = '.test-state';
const STATE_FILE = 'state.enc';

function createTestConfig(name: string): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

describe('state: durability', () => {

    let tempDir: string;
    let privateKey: string;
    let statePath: string;

    /** A fresh manager pointed at the same file — i.e. another process. */
    function newManager(): StateManager {

        return new StateManager(tempDir, {
            stateDir: STATE_DIR,
            stateFile: STATE_FILE,
            privateKey,
        });

    }

    beforeEach(async () => {

        resetStateManager();
        tempDir = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-durability-'));
        privateKey = (await generateKeyPair()).privateKey;
        statePath = join(tempDir, STATE_DIR, STATE_FILE);

        const seed = newManager();
        await seed.load();
        await seed.setConfig('dev', createTestConfig('dev'));

    });

    afterEach(() => {

        rmSync(tempDir, { recursive: true, force: true });
        resetStateManager();

    });

    // ─────────────────────────────────────────────────────────────
    // Concurrency
    // ─────────────────────────────────────────────────────────────

    describe('concurrent writers', () => {

        it('should not lose a secret written by another writer', async () => {

            // Both managers read the same state, then write in turn. A
            // whole-file overwrite from a stale snapshot silently discards
            // whatever the other one committed in between — ten parallel
            // `secret set` runs left five secrets, all exiting 0.
            const a = newManager();
            const b = newManager();
            await a.load();
            await b.load();

            await a.setSecret('dev', 'FROM_A', 'a');
            await b.setSecret('dev', 'FROM_B', 'b');

            const reader = newManager();
            await reader.load();

            expect(reader.getSecret('dev', 'FROM_A')).toBe('a');
            expect(reader.getSecret('dev', 'FROM_B')).toBe('b');

        });

        it('should not lose a global secret written by another writer', async () => {

            const a = newManager();
            const b = newManager();
            await a.load();
            await b.load();

            await a.setGlobalSecret('FROM_A', 'a');
            await b.setGlobalSecret('FROM_B', 'b');

            const reader = newManager();
            await reader.load();

            expect(reader.getGlobalSecret('FROM_A')).toBe('a');
            expect(reader.getGlobalSecret('FROM_B')).toBe('b');

        });

        it('should not lose a config written by another writer', async () => {

            const a = newManager();
            const b = newManager();
            await a.load();
            await b.load();

            await a.setConfig('from-a', createTestConfig('from-a'));
            await b.setConfig('from-b', createTestConfig('from-b'));

            const reader = newManager();
            await reader.load();

            expect(reader.getConfig('from-a')).not.toBeNull();
            expect(reader.getConfig('from-b')).not.toBeNull();
            expect(reader.getConfig('dev')).not.toBeNull();

        });

        it('should not resurrect a config the other writer deleted', async () => {

            // Reconciling a stale snapshot must not undo someone else's
            // delete — that would be just as silent as losing a write.
            const a = newManager();
            const b = newManager();
            await a.load();
            await b.load();

            await a.deleteConfig('dev');
            await b.setGlobalSecret('UNRELATED', 'x');

            const reader = newManager();
            await reader.load();

            expect(reader.getConfig('dev')).toBeNull();
            expect(reader.getGlobalSecret('UNRELATED')).toBe('x');

        });

        it('should keep our own delete when reconciling with another writer', async () => {

            const a = newManager();
            const b = newManager();
            await a.load();
            await b.load();

            await a.setGlobalSecret('UNRELATED', 'x');
            await b.deleteConfig('dev');

            const reader = newManager();
            await reader.load();

            expect(reader.getConfig('dev')).toBeNull();
            expect(reader.getGlobalSecret('UNRELATED')).toBe('x');

        });

        it('should survive concurrent writes from separate processes', async () => {

            const fixture = join(import.meta.dir, 'fixtures', 'concurrent-writer.ts');
            const keys = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

            const results = await Promise.all(
                keys.map(async (key) => {

                    const proc = Bun.spawn(
                        ['bun', 'run', fixture, tempDir, privateKey, key, `v-${key}`],
                        { stdout: 'pipe', stderr: 'pipe' },
                    );

                    return {
                        key,
                        code: await proc.exited,
                        stderr: await new Response(proc.stderr).text(),
                    };

                }),
            );

            for (const result of results) {

                expect({ key: result.key, code: result.code, stderr: result.stderr })
                    .toEqual({ key: result.key, code: 0, stderr: '' });

            }

            const reader = newManager();
            await reader.load();

            expect(reader.listSecrets('dev').sort()).toEqual([...keys].sort());

        }, 30_000);

    });

    // ─────────────────────────────────────────────────────────────
    // Atomicity and backup
    // ─────────────────────────────────────────────────────────────

    describe('atomic write', () => {

        it('should leave no temp files behind after a persist', async () => {

            const manager = newManager();
            await manager.load();
            await manager.setSecret('dev', 'K', 'v');

            const leftovers = readdirSync(dirname(statePath)).filter((f) => f.endsWith('.tmp'));

            expect(leftovers).toEqual([]);

        });

        it('should release the write lock after a persist', async () => {

            const manager = newManager();
            await manager.load();
            await manager.setSecret('dev', 'K', 'v');

            const leftovers = readdirSync(dirname(statePath)).filter((f) => f.endsWith('.lock'));

            expect(leftovers).toEqual([]);

        });

        it('should break a stale lock rather than blocking forever', async () => {

            // A lock left behind by a killed process must not brick every
            // future write.
            const lockPath = `${statePath}.lock`;
            writeFileSync(lockPath, '999999');
            const stale = new Date(Date.now() - 5 * 60_000);
            utimesSync(lockPath, stale, stale);

            const manager = newManager();
            await manager.load();

            const [, err] = await attempt(() => manager.setSecret('dev', 'K', 'v'));

            expect(err).toBeNull();
            expect(existsSync(lockPath)).toBe(false);
            expect(manager.getSecret('dev', 'K')).toBe('v');

        });

        it('should keep the previous state intact when the write fails', async () => {

            const manager = newManager();
            await manager.load();
            await manager.setSecret('dev', 'BEFORE', 'v');

            const before = readFileSync(statePath, 'utf8');
            const stateDir = dirname(statePath);

            // A read-only directory still permits O_TRUNC on an existing
            // file, so a whole-file overwrite destroys state.enc here while
            // a write that stages elsewhere and renames cannot start.
            chmodSync(stateDir, 0o500);
            const [, err] = await attempt(() => manager.setSecret('dev', 'AFTER', 'v'));
            chmodSync(stateDir, 0o700);

            expect(err).toBeInstanceOf(Error);
            expect(readFileSync(statePath, 'utf8')).toBe(before);

        });

    });

    describe('backup', () => {

        it('should keep the previous generation as state.enc.bak', async () => {

            const manager = newManager();
            await manager.load();

            const firstGeneration = readFileSync(statePath, 'utf8');
            await manager.setSecret('dev', 'K', 'v');

            expect(readFileSync(`${statePath}.bak`, 'utf8')).toBe(firstGeneration);

        });

        it('should write the backup at mode 0600', async () => {

            const manager = newManager();
            await manager.load();
            await manager.setSecret('dev', 'K', 'v');

            expect(statSync(`${statePath}.bak`).mode & 0o777).toBe(0o600);

        });

        it('should let a destroyed state.enc be recovered from the backup', async () => {

            const manager = newManager();
            await manager.load();
            await manager.setSecret('dev', 'RECOVERABLE', 'v');
            await manager.setGlobalSecret('LATER', 'x');

            writeFileSync(statePath, readFileSync(`${statePath}.bak`, 'utf8'));

            const reader = newManager();
            await reader.load();

            expect(reader.getSecret('dev', 'RECOVERABLE')).toBe('v');

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Corrupted files
    // ─────────────────────────────────────────────────────────────

    describe('corrupted state file', () => {

        it('should reject a truncated state file without destroying it', async () => {

            const raw = readFileSync(statePath, 'utf8');
            writeFileSync(statePath, raw.slice(0, Math.floor(raw.length / 2)));

            const manager = newManager();
            const [, err] = await attempt(() => manager.load());

            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toContain('may be corrupted');
            expect(readFileSync(statePath, 'utf8')).toBe(raw.slice(0, Math.floor(raw.length / 2)));

        });

        it('should reject a zero-length state file', async () => {

            writeFileSync(statePath, '');

            const manager = newManager();
            const [, err] = await attempt(() => manager.load());

            expect((err as Error).message).toContain('may be corrupted');

        });

        it('should reject a state file whose ciphertext was tampered with', async () => {

            const payload = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, string>;
            const bytes = Buffer.from(payload['ciphertext']!, 'base64');
            bytes[0] = bytes[0]! ^ 0xff;
            payload['ciphertext'] = bytes.toString('base64');
            writeFileSync(statePath, JSON.stringify(payload));

            const manager = newManager();
            const [, err] = await attempt(() => manager.load());

            expect((err as Error).message).toContain('Wrong key or corrupted file');

        });

        it('should reject a state file whose decrypted body is not JSON', async () => {

            const { encrypt } = await import('../../../src/core/state/encryption/index.js');
            mkdirSync(dirname(statePath), { recursive: true });
            writeFileSync(statePath, JSON.stringify(encrypt('not json at all', privateKey)));

            const manager = newManager();
            const [, err] = await attempt(() => manager.load());

            expect((err as Error).message).toContain('Failed to parse decrypted state');

        });

    });

    // ─────────────────────────────────────────────────────────────
    // Downgrade
    // ─────────────────────────────────────────────────────────────

    describe('downgrade', () => {

        it('should refuse to open state written by a newer schema version', async () => {

            const { encrypt } = await import('../../../src/core/state/encryption/index.js');
            const { CURRENT_VERSIONS } = await import('../../../src/core/version/types.js');

            const future = {
                version: '99.0.0',
                schemaVersion: CURRENT_VERSIONS.state + 5,
                knownUsers: {},
                activeConfig: null,
                configs: {},
                secrets: {},
                globalSecrets: {},
            };

            writeFileSync(statePath, JSON.stringify(encrypt(JSON.stringify(future), privateKey)));

            const manager = newManager();
            const [, err] = await attempt(() => manager.load());

            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toContain('newer than');

        });

        it('should not rewrite state it refused to open', async () => {

            const { encrypt } = await import('../../../src/core/state/encryption/index.js');
            const { CURRENT_VERSIONS } = await import('../../../src/core/version/types.js');

            const future = {
                version: '99.0.0',
                schemaVersion: CURRENT_VERSIONS.state + 5,
                knownUsers: {},
                activeConfig: null,
                configs: {},
                secrets: {},
                globalSecrets: {},
                auditTrail: ['a-field-this-build-knows-nothing-about'],
            };

            const raw = JSON.stringify(encrypt(JSON.stringify(future), privateKey));
            writeFileSync(statePath, raw);

            const manager = newManager();
            await attempt(() => manager.load());

            expect(readFileSync(statePath, 'utf8')).toBe(raw);

        });

    });

});

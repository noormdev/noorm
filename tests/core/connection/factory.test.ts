/**
 * Connection factory tests.
 *
 * Uses SQLite in-memory databases for testing (no external DB needed).
 */
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { sql } from 'kysely';
import { createConnection, testConnection } from '../../../src/core/connection/index.js';
import type { ConnectionConfig } from '../../../src/core/connection/index.js';
import { observer, type NoormEvents } from '../../../src/core/observer.js';
import { attempt } from '@logosdx/utils';
import { SslFileError } from '../../../src/core/connection/ssl-files.js';

describe('connection: factory', () => {

    const connections: Array<{ destroy: () => Promise<void> }> = [];

    afterEach(async () => {

        // Clean up all connections
        for (const conn of connections) {

            await conn.destroy();

        }
        connections.length = 0;

    });

    describe('createConnection', () => {

        it('should create a SQLite in-memory connection', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            };

            const conn = await createConnection(config);
            connections.push(conn);

            expect(conn.dialect).toBe('sqlite');
            expect(conn.db).toBeDefined();

        });

        it('should execute queries on SQLite connection', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            };

            const conn = await createConnection(config);
            connections.push(conn);

            // Create a table
            await sql`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`.execute(conn.db);

            // Insert data
            await sql`INSERT INTO test (id, name) VALUES (1, 'Alice')`.execute(conn.db);
            await sql`INSERT INTO test (id, name) VALUES (2, 'Bob')`.execute(conn.db);

            // Query data
            const result = await sql<{
                id: number;
                name: string;
            }>`SELECT * FROM test ORDER BY id`.execute(conn.db);

            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]!.name).toBe('Alice');
            expect(result.rows[1]!.name).toBe('Bob');

        });

        it('should reject driver options on SQLite, which has no driver options to merge them into', async () => {

            const opening = createConnection({ dialect: 'sqlite', database: ':memory:' }, '__test__', {}, undefined, { driver: { readonly: true } });

            await expect(opening).rejects.toThrow('Driver options are not supported for SQLite');

        });

        it('should throw for unsupported dialect', async () => {

            const config = {
                dialect: 'oracle' as never,
                database: 'test',
            };

            await expect(createConnection(config)).rejects.toThrow('Unsupported dialect');

        });

    });

    describe('retryOptions (v1/49-54 finding 1 — best-effort probe fails fast)', () => {

        it('should not apply the default retry/backoff when retryOptions overrides to a single attempt', async () => {

            // Nothing listens here — a fast, certain ECONNREFUSED, not a
            // slow network timeout. The default policy (3 attempts, ~2s
            // apart) would take ~6-7s; overriding to one attempt with no
            // delay must skip that wait entirely.
            const config: ConnectionConfig = {
                dialect: 'postgres',
                host: '127.0.0.1',
                port: 59999,
                database: 'nope',
            };

            const start = Date.now();

            await expect(
                createConnection(config, '__probe__', { retries: 1, delay: 0 }),
            ).rejects.toThrow();

            const elapsed = Date.now() - start;

            // The default policy measured 6252ms here, so 4500 still fails
            // loudly if the override stops working. Deliberately not tighter:
            // a bare refused connection takes milliseconds, and the slack is
            // for a loaded runner, not for the behaviour under test.
            expect(elapsed).toBeLessThan(4500);

        });

    });

    describe('connection:open target (CP9.5, v1/49-54)', () => {

        // `NoormEvents['connection:open']` (src/core/observer.ts) still
        // declares only configName/dialect -- widening that shared type is
        // out of this checkpoint's scope. The extra fields exist on the
        // runtime payload regardless, so assert on the raw shape rather
        // than the (currently narrower) declared event type.

        it('should carry host, port, and database, removing the "which database" ambiguity #51 reported', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
                host: 'db.internal',
                port: 5432,
            };

            const events: Array<Record<string, unknown>> = [];
            const cleanup = observer.on('connection:open', (data) => events.push(data as Record<string, unknown>));

            const conn = await createConnection(config, 'test-target-config');
            connections.push(conn);
            cleanup();

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                configName: 'test-target-config',
                dialect: 'sqlite',
                host: 'db.internal',
                port: 5432,
                database: ':memory:',
            });

        });

        it('should never carry credentials', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
                user: 'should-not-appear',
                password: 'super-secret-password',
            };

            const events: Array<Record<string, unknown>> = [];
            const cleanup = observer.on('connection:open', (data) => events.push(data as Record<string, unknown>));

            const conn = await createConnection(config, 'test-no-creds');
            connections.push(conn);
            cleanup();

            expect(events[0]).not.toHaveProperty('user');
            expect(events[0]).not.toHaveProperty('password');
            expect(JSON.stringify(events[0])).not.toContain('super-secret-password');

        });

    });

    describe('testConnection', () => {

        it('should return ok: true for valid SQLite connection', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            };

            const result = await testConnection(config);

            expect(result.ok).toBe(true);
            expect(result.error).toBeUndefined();

        });

        it('should return ok: false for invalid connection', async () => {

            // Use SQLite with invalid path to avoid network timeouts
            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: '/nonexistent/path/that/does/not/exist/db.sqlite',
            };

            const result = await testConnection(config);

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();

        });

    });

    // ─────────────────────────────────────────────────────
    // testServerOnly is documented as "verify credentials without
    // requiring the target database" — the setup-wizard case. On SQLite
    // there is no system database to swap to, so the probe used to open
    // the target path, and the driver created it. A wizard's "Test
    // Connection" button then left a zero-byte database behind and the
    // user could no longer tell a fresh target from one testing made.
    // ─────────────────────────────────────────────────────

    describe('testConnection with testServerOnly on sqlite', () => {

        let tmpDir: string;

        beforeEach(() => {

            tmpDir = mkdtempSync(join(tmpdir(), 'noorm-server-only-'));

        });

        afterEach(() => {

            rmSync(tmpDir, { recursive: true, force: true });

        });

        it('does not create the target file when it does not exist yet', async () => {

            const dbPath = join(tmpDir, 'fresh.db');

            const config: ConnectionConfig = { dialect: 'sqlite', database: dbPath };

            const result = await testConnection(config, { testServerOnly: true });

            expect(result.ok).toBe(true);
            expect(existsSync(dbPath)).toBe(false);

        });

        it('still reports failure when the target directory is not reachable', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: '/nonexistent/path/that/does/not/exist/db.sqlite',
            };

            const result = await testConnection(config, { testServerOnly: true });

            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();

        });

        it('still opens and validates a target that already exists', async () => {

            const dbPath = join(tmpDir, 'existing.db');
            const seed = await createConnection({ dialect: 'sqlite', database: dbPath }, 'seed');
            await seed.destroy();

            expect(existsSync(dbPath)).toBe(true);

            const result = await testConnection({ dialect: 'sqlite', database: dbPath }, { testServerOnly: true });

            expect(result.ok).toBe(true);
            expect(existsSync(dbPath)).toBe(true);

        });

    });

    describe('ssl file fields', () => {

        let certDir: string;

        const missingPath = () => join(certDir, 'econnrefused-ca.pem');
        const server = (ssl: ConnectionConfig['ssl']): ConnectionConfig =>
            ({ dialect: 'postgres', host: '127.0.0.1', port: 1, user: 'probe', database: 'probe_test', ssl });

        function recordErrors(configName: string) {

            const events: NoormEvents['connection:error'][] = [];
            const stop = observer.on('connection:error', (event) => {

                if (event.configName === configName) events.push(event);

            });

            return { events, stop };

        }

        beforeEach(() => {

            certDir = mkdtempSync(join(tmpdir(), 'noorm-factory-ssl-'));

        });

        afterEach(() => {

            rmSync(certDir, { recursive: true, force: true });

        });

        it('should rethrow SslFileError as the same type, with no serverCode on the event', async () => {

            const { events, stop } = recordErrors('__ssl_file__');
            const [, err] = await attempt(() =>
                createConnection(server({ caFile: missingPath() }), '__ssl_file__', { retries: 1, delay: 0 }),
            );

            stop();

            expect(err).toBeInstanceOf(SslFileError);
            expect(events).toHaveLength(1);
            expect(events[0]!.error).toBe(err!.message);
            expect(events[0]!.serverCode).toBeUndefined();

        });

        it('should not retry an SslFileError, even when the path holds a retry word', async () => {

            // One burst per attempt.
            let reads = 0;
            const counting = (): ConnectionConfig['ssl'] => ({
                get caFile() {

                    reads++;

                    return missingPath();

                },
            });

            await attempt(() => createConnection(server(counting()), '__ssl_once__', { retries: 1, delay: 0 }));

            const readsPerAttempt = reads;

            reads = 0;

            await attempt(() => createConnection(server(counting()), '__ssl_once__', { retries: 3, delay: 0 }));

            expect(readsPerAttempt).toBeGreaterThan(0);
            expect(reads).toBe(readsPerAttempt);

        });

        it('should emit the SslFileError message unmasked under a runtime.password callback', async () => {

            const { events, stop } = recordErrors('__ssl_runtime__');
            const [, err] = await attempt(() =>
                createConnection(
                    server({ caFile: missingPath() }),
                    '__ssl_runtime__',
                    { retries: 1, delay: 0 },
                    undefined,
                    { password: () => 'secret' },
                ),
            );

            stop();

            expect(err).toBeInstanceOf(SslFileError);
            expect(events).toHaveLength(1);
            expect(events[0]!.error).toBe(err!.message);
            expect(events[0]!.error).not.toBe('Runtime credential connection failed');

        });

        it('should leave a malformed PEM keyFile out of every error, cause and event once TLS parses it', async () => {

            const marker = 'NOT-A-KEY-secret-marker';
            const keyFile = join(certDir, 'key.pem');

            writeFileSync(keyFile, `-----BEGIN PRIVATE KEY-----\n${marker}\n-----END PRIVATE KEY-----\n`);

            // Answers pg's SSLRequest with 'S' so pg hands the key to tls.connect.
            const tlsPeer = createServer((socket) => {

                socket.once('data', () => socket.write('S'));
                socket.on('error', () => {});

            });

            await new Promise<void>((resolve) => tlsPeer.listen(0, '127.0.0.1', resolve));

            const address = tlsPeer.address();
            const port = typeof address === 'object' && address ? address.port : 0;

            const { events, stop } = recordErrors('__ssl_key__');
            const [, err] = await attempt(() =>
                createConnection(
                    { ...server({ keyFile }), port },
                    '__ssl_key__',
                    { retries: 1, delay: 0 },
                ),
            );

            stop();
            await new Promise<void>((resolve) => tlsPeer.close(() => resolve()));

            expect(err).toBeDefined();
            expect(err).not.toBeInstanceOf(SslFileError);
            expect(err?.message).toMatch(/PEM routines|DECODER routines/);

            const seen: string[] = [];

            for (let cause: unknown = err; cause instanceof Error; cause = cause.cause) {

                seen.push(cause.message, cause.stack ?? '');

            }

            expect(seen.length).toBeGreaterThan(0);
            expect(seen.join('\n')).not.toContain(marker);
            expect(JSON.stringify(events)).not.toContain(marker);
            expect(events).toHaveLength(1);

        });

        it('should refuse a keyFile with no PEM block with ENOTPEM before any dial and leak nothing', async () => {

            const marker = 'NOT-A-KEY-secret-marker';
            const keyFile = join(certDir, 'plain.pem');

            writeFileSync(keyFile, marker);

            const { events, stop } = recordErrors('__ssl_notpem__');
            const [, err] = await attempt(() =>
                createConnection(server({ keyFile }), '__ssl_notpem__', { retries: 1, delay: 0 }),
            );

            stop();

            expect(err).toBeInstanceOf(SslFileError);
            expect(err).toHaveProperty('code', 'ENOTPEM');
            expect(err?.message).not.toContain(marker);
            expect(JSON.stringify(events)).not.toContain(marker);
            expect(events).toHaveLength(1);

        });

        it('should leave the config it received holding paths and no PEM after a connect', async () => {

            const caFile = join(certDir, 'ca.pem');

            writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nthrowaway-ca\n-----END CERTIFICATE-----\n');

            const config = server({ caFile });

            const [, err] = await attempt(() => createConnection(config, '__ssl_pure__', { retries: 1, delay: 0 }));

            expect(err).not.toBeInstanceOf(SslFileError);
            expect(config.ssl).toEqual({ caFile });

        });

        it('should report the SslFileError message from testConnection for an unreadable path', async () => {

            const result = await testConnection(server({ caFile: missingPath() }));

            expect(result.ok).toBe(false);
            expect(result.error).toContain('ssl.caFile');
            expect(result.error).toContain(missingPath());

        });

        it('should not fall back to the system database when an SslFileError path holds "does not exist"', async () => {

            const caFile = join(certDir, 'does not exist', 'ca.pem');
            const { events, stop } = recordErrors('__test__');

            const result = await testConnection(server({ caFile }), { testServerOnly: true });

            stop();

            expect(result.ok).toBe(false);
            expect(result.error).toContain('ssl.caFile');
            expect(result.error).toContain(caFile);
            expect(events).toHaveLength(1);

        });

    });

    describe('connection lifecycle', () => {

        it('should destroy connection cleanly', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            };

            const conn = await createConnection(config);

            // Destroy should not throw
            await expect(conn.destroy()).resolves.toBeUndefined();

            // Using the connection after destroy should fail
            await expect(sql`SELECT 1`.execute(conn.db)).rejects.toThrow();

        });

    });

});

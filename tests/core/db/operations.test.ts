/**
 * Unit tests for database lifecycle operations.
 *
 * Uses SQLite files as real targets, so "the database exists" is a real
 * filesystem fact rather than a stub — `destroyDb` reporting `dropped: true`
 * for something that was never there is exactly the defect under test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { createDb, destroyDb } from '../../../src/core/db/index.js';
import type { ConnectionConfig } from '../../../src/core/connection/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';

const VIEWER: ConfigAccess = { user: 'viewer', mcp: 'viewer' };
const OPERATOR: ConfigAccess = { user: 'operator', mcp: 'operator' };
const ADMIN: ConfigAccess = { user: 'admin', mcp: 'admin' };

describe('db: lifecycle operations', () => {

    let tmpDir: string;
    let dbPath: string;
    let config: ConnectionConfig;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-ops-'));
        dbPath = join(tmpDir, 'target.db');
        config = { dialect: 'sqlite', database: dbPath };

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    // ─────────────────────────────────────────────────────
    // destroyDb — "dropped" must mean something happened
    // ─────────────────────────────────────────────────────

    describe('destroyDb', () => {

        it('reports dropped: true when the database was really there', async () => {

            await createDb(config, 'test');
            expect(existsSync(dbPath)).toBe(true);

            const result = await destroyDb(config, 'test');

            expect(result.ok).toBe(true);
            expect(result.dropped).toBe(true);
            expect(existsSync(dbPath)).toBe(false);

        });

        it('reports dropped: false when there was nothing to drop', async () => {

            // Every dialect's drop is IF EXISTS, so success alone cannot
            // distinguish "destroyed it" from "the name was wrong". A CI job
            // that names the wrong database used to get a green dropped: true.
            expect(existsSync(dbPath)).toBe(false);

            const result = await destroyDb(config, 'test');

            expect(result.ok).toBe(true);
            expect(result.dropped).toBe(false);

        });

        it('is not fooled into reporting a second drop as real', async () => {

            await createDb(config, 'test');

            const first = await destroyDb(config, 'test');
            const second = await destroyDb(config, 'test');

            expect(first.dropped).toBe(true);
            expect(second.dropped).toBe(false);

        });

    });

    // ─────────────────────────────────────────────────────
    // Core-seam policy gate
    // ─────────────────────────────────────────────────────

    describe('policy gate', () => {

        it('refuses createDb for a role the matrix denies', async () => {

            const result = await createDb(config, 'test', {
                policy: { configName: 'prod', access: VIEWER },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('db:create');
            expect(existsSync(dbPath)).toBe(false);

        });

        it('refuses createDb for an unconfirmed confirm cell', async () => {

            const result = await createDb(config, 'test', {
                policy: { configName: 'prod', access: OPERATOR },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('requiring confirmation');
            expect(existsSync(dbPath)).toBe(false);

        });

        it('allows createDb once the caller pre-confirms', async () => {

            const result = await createDb(config, 'test', {
                policy: { configName: 'prod', access: OPERATOR, yes: true },
            });

            expect(result.ok).toBe(true);
            expect(existsSync(dbPath)).toBe(true);

        });

        it('allows createDb outright for a role the matrix allows', async () => {

            const result = await createDb(config, 'test', {
                policy: { configName: 'dev', access: ADMIN },
            });

            expect(result.ok).toBe(true);
            expect(existsSync(dbPath)).toBe(true);

        });

        it('refuses destroyDb for a role the matrix denies, leaving the database intact', async () => {

            await createDb(config, 'test');

            const result = await destroyDb(config, 'test', {
                policy: { configName: 'prod', access: OPERATOR },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('db:destroy');
            expect(existsSync(dbPath)).toBe(true);

        });

        it('refuses an unconfirmed destroyDb even for admin', async () => {

            await createDb(config, 'test');

            const result = await destroyDb(config, 'test', {
                policy: { configName: 'dev', access: ADMIN },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('requiring confirmation');
            expect(existsSync(dbPath)).toBe(true);

        });

        it('runs ungated when no policy is supplied, for callers that own their own gate', async () => {

            const [result, err] = await attempt(() => createDb(config, 'test'));

            expect(err).toBeNull();
            expect(result?.ok).toBe(true);

        });

    });

});

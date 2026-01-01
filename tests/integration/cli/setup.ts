/**
 * CLI Integration Test Setup.
 *
 * Provides helpers for running CLI commands in headless mode and
 * asserting on stdout, stderr, exit codes, and JSON output.
 *
 * Uses zx/lite for shell command execution and env-only mode for configuration.
 * This avoids the need for encrypted state files - all config comes from env vars.
 *
 * @example
 * ```typescript
 * import { noorm, noormJson, setupTestProject, cleanupTestProject } from './setup.js'
 *
 * describe('cli: db explore', () => {
 *
 *     let testDir: string
 *
 *     beforeAll(async () => {
 *         testDir = await setupTestProject()
 *     })
 *
 *     afterAll(async () => {
 *         await cleanupTestProject(testDir)
 *     })
 *
 *     it('should return database overview', async () => {
 *         const result = await noorm(testDir, 'db', 'explore')
 *         expect(result.ok).toBe(true)
 *     })
 * })
 * ```
 */
import { $ } from 'zx';
import { join } from 'node:path';
import { mkdir, rm, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';
import { deployTestSchema, seedTestData } from '../../utils/db.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/**
 * Path to the built CLI entry point.
 */
const CLI = join(import.meta.dirname, '../../../dist/cli/index.js');

/**
 * Base temp directory for test projects.
 */
const TMP_BASE = join(import.meta.dirname, '../../../tmp');

/**
 * Path to schema fixtures.
 */
const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures/schema/sqlite');

// ─────────────────────────────────────────────────────────────
// CLI Execution
// ─────────────────────────────────────────────────────────────

/**
 * Configured $ for CLI tests.
 *
 * - verbose: false - quiet zx output
 * - nothrow: true - don't throw on non-zero exit codes
 */
const cli = $({
    verbose: false,
    nothrow: true,
});

/**
 * Test project context returned by setupTestProject.
 */
export interface TestProject {
    /** Path to the test project directory */
    dir: string;
    /** Path to the SQLite database file */
    dbPath: string;
    /** Environment variables for CLI commands */
    env: Record<string, string>;
}

/**
 * Run a CLI command in headless mode.
 *
 * @param project - Test project context
 * @param args - CLI arguments
 * @returns ProcessOutput with stdout, stderr, exitCode, ok
 *
 * @example
 * ```typescript
 * const result = await noorm(project, 'db', 'explore')
 * expect(result.ok).toBe(true)
 * expect(result.exitCode).toBe(0)
 * ```
 */
export async function noorm(project: TestProject, ...args: string[]) {

    // zx handles arrays by joining with spaces, which is correct for CLI args
    const cmdArgs = ['-H', ...args];

    return cli({ cwd: project.dir, env: { ...process.env, ...project.env } })`node ${CLI} ${cmdArgs}`;

}

/**
 * Run a CLI command with JSON output.
 *
 * @param project - Test project context
 * @param args - CLI arguments
 * @returns Parsed JSON output
 *
 * @example
 * ```typescript
 * interface DbOverview { tables: number; views: number }
 * const result = await noormJson<DbOverview>(project, 'db', 'explore')
 * expect(result.tables).toBeGreaterThan(0)
 * ```
 */
export async function noormJson<T>(project: TestProject, ...args: string[]): Promise<{
    data: T | null;
    error: string | null;
    exitCode: number;
    ok: boolean;
}> {

    // zx handles arrays by joining with spaces, which is correct for CLI args
    const cmdArgs = ['-H', '--json', ...args];

    const result = await cli({ cwd: project.dir, env: { ...process.env, ...project.env } })`node ${CLI} ${cmdArgs}`;

    if (!result.ok) {

        return {
            data: null,
            error: result.stderr || result.stdout,
            exitCode: result.exitCode,
            ok: false,
        };

    }

    // Extract JSON from output (may contain logger lines after the JSON)
    const jsonStr = extractJson(result.stdout);

    if (!jsonStr) {

        return {
            data: null,
            error: `No JSON found in output: ${result.stdout}`,
            exitCode: result.exitCode,
            ok: false,
        };

    }

    try {

        const data = JSON.parse(jsonStr) as T;

        return { data, error: null, exitCode: 0, ok: true };

    }
    catch {

        return {
            data: null,
            error: `Failed to parse JSON: ${jsonStr}`,
            exitCode: result.exitCode,
            ok: false,
        };

    }

}

/**
 * Extract JSON from CLI output.
 *
 * The CLI may include logger lines after the JSON output.
 * This function finds and extracts just the JSON portion by
 * looking for balanced braces/brackets.
 */
function extractJson(output: string): string | null {

    const trimmed = output.trim();

    // Find the first { or [ character
    const startObj = trimmed.indexOf('{');
    const startArr = trimmed.indexOf('[');

    let start: number;

    if (startObj === -1 && startArr === -1) {

        return null;

    }
    else if (startObj === -1) {

        start = startArr;

    }
    else if (startArr === -1) {

        start = startObj;

    }
    else {

        // Use whichever comes first
        start = startObj < startArr ? startObj : startArr;

    }

    // Find matching end by counting braces/brackets
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < trimmed.length; i++) {

        const char = trimmed[i]!;

        if (escaped) {

            escaped = false;
            continue;

        }

        if (char === '\\') {

            escaped = true;
            continue;

        }

        if (char === '"') {

            inString = !inString;
            continue;

        }

        if (inString) continue;

        if (char === '{' || char === '[') {

            depth++;

        }
        else if (char === '}' || char === ']') {

            depth--;

            if (depth === 0) {

                return trimmed.slice(start, i + 1);

            }

        }

    }

    return null;

}

// ─────────────────────────────────────────────────────────────
// Color Testing Utilities
// ─────────────────────────────────────────────────────────────

/**
 * Check if output contains ANSI color codes.
 *
 * @param output - String to check for ANSI codes
 * @returns True if ANSI codes are present
 *
 * @example
 * ```typescript
 * const result = await noorm(testDir, 'db', 'explore')
 * expect(hasAnsiColors(result.stdout)).toBe(true)
 * ```
 */
export function hasAnsiColors(output: string): boolean {

    return /\x1b\[[0-9;]*m/.test(output);

}

/**
 * Strip ANSI color codes from output.
 *
 * @param output - String with ANSI codes
 * @returns String with ANSI codes removed
 *
 * @example
 * ```typescript
 * const text = stripAnsi(result.stdout)
 * expect(text).toContain('Tables:')
 * ```
 */
export function stripAnsi(output: string): string {

    return output.replace(/\x1b\[[0-9;]*m/g, '');

}

// ─────────────────────────────────────────────────────────────
// Test Project Setup
// ─────────────────────────────────────────────────────────────

/**
 * Create a test project directory with noorm structure.
 *
 * Uses env-only mode (no encrypted state files needed):
 * - Creates temp directory with schema/changesets
 * - Creates SQLite database with test schema
 * - Returns env vars for CLI commands
 *
 * @returns Test project context with dir, dbPath, and env vars
 *
 * @example
 * ```typescript
 * const project = await setupTestProject()
 * const result = await noorm(project, 'db', 'explore')
 * await cleanupTestProject(project)
 * ```
 */
export async function setupTestProject(): Promise<TestProject> {

    // Create unique temp directory
    const testId = randomUUID().slice(0, 8);
    const testDir = join(TMP_BASE, `test-${testId}`);

    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, '.noorm'), { recursive: true });
    await mkdir(join(testDir, 'schema'), { recursive: true });
    await mkdir(join(testDir, 'changesets'), { recursive: true });

    // Copy schema fixtures
    await cp(FIXTURES_DIR, join(testDir, 'schema'), { recursive: true });

    // Create SQLite database file path
    const dbPath = join(testDir, '.noorm', 'test.db');

    // Create connection config for SQLite file
    const connectionConfig: ConnectionConfig = {
        dialect: 'sqlite',
        database: dbPath,
    };

    // Create connection and deploy schema
    const conn = await createConnection(connectionConfig, '__test__');

    // Create noorm internal tables (needed for lock, changeset tracking)
    await createNoormTables(conn.db as Kysely<unknown>);

    // Deploy test schema and seed data
    await deployTestSchema(conn.db as Kysely<unknown>, 'sqlite');
    await seedTestData(conn.db as Kysely<unknown>, 'sqlite');
    await conn.destroy();

    // Environment variables for CLI (env-only mode)
    const env: Record<string, string> = {
        NOORM_CONNECTION_DIALECT: 'sqlite',
        NOORM_CONNECTION_DATABASE: dbPath,
        NOORM_PATHS_SCHEMA: './schema',
        NOORM_PATHS_CHANGESETS: './changesets',
        NOORM_NAME: '__test__',
        NOORM_ISTEST: 'true',
    };

    return { dir: testDir, dbPath, env };

}

/**
 * Clean up a test project.
 *
 * @param project - Test project to clean up
 */
export async function cleanupTestProject(project: TestProject): Promise<void> {

    try {

        await rm(project.dir, { recursive: true, force: true });

    }
    catch {
        // Ignore cleanup errors
    }

}

/**
 * Ensure the tmp directory exists.
 *
 * Call this in vitest's globalSetup to prepare the environment.
 */
export async function ensureTmpDir(): Promise<void> {

    await mkdir(TMP_BASE, { recursive: true });

}

/**
 * Clean all test projects from tmp directory.
 *
 * Call this in vitest's globalTeardown for complete cleanup.
 */
export async function cleanupAllTestProjects(): Promise<void> {

    try {

        await rm(TMP_BASE, { recursive: true, force: true });

    }
    catch {
        // Ignore if already clean
    }

}

// ─────────────────────────────────────────────────────────────
// Internal Tables Setup
// ─────────────────────────────────────────────────────────────

/**
 * Create noorm internal tables required for CLI operations.
 *
 * These tables are needed for:
 * - __noorm_version__: Schema version tracking
 * - __noorm_changeset__: Changeset execution history
 * - __noorm_executions__: File execution records
 * - __noorm_lock__: Database locking
 * - __noorm_identities__: Identity management
 */
async function createNoormTables(db: Kysely<unknown>): Promise<void> {

    // __noorm_version__
    await sql`
        CREATE TABLE IF NOT EXISTS __noorm_version__ (
            id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `.execute(db);

    // __noorm_changeset__
    await sql`
        CREATE TABLE IF NOT EXISTS __noorm_changeset__ (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            applied_at TEXT,
            reverted_at TEXT,
            checksum TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `.execute(db);

    // __noorm_executions__
    await sql`
        CREATE TABLE IF NOT EXISTS __noorm_executions__ (
            id TEXT PRIMARY KEY,
            changeset_id TEXT REFERENCES __noorm_changeset__(id),
            filepath TEXT NOT NULL,
            status TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'up',
            checksum TEXT,
            error TEXT,
            duration_ms INTEGER,
            executed_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `.execute(db);

    // __noorm_lock__
    await sql`
        CREATE TABLE IF NOT EXISTS __noorm_lock__ (
            id TEXT PRIMARY KEY,
            config_name TEXT NOT NULL UNIQUE,
            locked_by TEXT NOT NULL,
            locked_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT ''
        )
    `.execute(db);

    // __noorm_identities__
    await sql`
        CREATE TABLE IF NOT EXISTS __noorm_identities__ (
            id TEXT PRIMARY KEY,
            config_name TEXT NOT NULL,
            identity TEXT NOT NULL,
            first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(config_name, identity)
        )
    `.execute(db);

}

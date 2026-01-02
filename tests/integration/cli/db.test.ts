/**
 * CLI Integration Tests: Database Operations.
 *
 * Tests for db/explore, db/truncate, and db/teardown commands.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
    noorm,
    noormJson,
    setupTestProject,
    cleanupTestProject,
    stripAnsi,
    type TestProject,
} from './setup.js';

// ─────────────────────────────────────────────────────────────
// Types for JSON Output
// ─────────────────────────────────────────────────────────────

interface ExploreOverview {
    tables: number;
    views: number;
    functions: number;
    procedures: number;
    types: number;
}

interface TableSummary {
    name: string;
    columnCount: number;
    schema?: string;
}

interface TableDetail {
    name: string;
    schema?: string;
    columns: Array<{
        name: string;
        dataType: string;
        nullable: boolean;
        defaultValue?: string;
    }>;
}

interface TruncateResult {
    truncated: string[];
    count: number;
}

interface TeardownResult {
    dropped: {
        tables: string[];
        views: string[];
        functions: string[];
        types: string[];
    };
    count: number;
}

// ─────────────────────────────────────────────────────────────
// Test Suite: db/explore
// ─────────────────────────────────────────────────────────────

describe('cli: db explore', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'db', 'explore');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should output text with database overview label', async () => {

        const result = await noorm(project, 'db', 'explore');

        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text).toContain('Database Overview');

    });

    it('should return valid JSON with --json flag', async () => {

        const result = await noormJson<ExploreOverview>(project, 'db', 'explore');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(typeof result.data!.tables).toBe('number');
        expect(typeof result.data!.views).toBe('number');

    });

    it('should show table count in overview', async () => {

        const result = await noormJson<ExploreOverview>(project, 'db', 'explore');

        expect(result.ok).toBe(true);
        // Our test schema has 3 tables: users, todo_lists, todo_items
        expect(result.data!.tables).toBeGreaterThanOrEqual(3);

    });

    it('should show view count in overview', async () => {

        const result = await noormJson<ExploreOverview>(project, 'db', 'explore');

        expect(result.ok).toBe(true);
        // Our test schema has 3 views
        expect(result.data!.views).toBeGreaterThanOrEqual(3);

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: db/explore/tables
// ─────────────────────────────────────────────────────────────

describe('cli: db explore tables', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'db', 'explore', 'tables');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should output text with tables label', async () => {

        const result = await noorm(project, 'db', 'explore', 'tables');

        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text).toContain('Tables:');

    });

    it('should return valid JSON with --json flag', async () => {

        const result = await noormJson<TableSummary[]>(project, 'db', 'explore', 'tables');

        expect(result.ok).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);

    });

    it('should list all tables with column counts', async () => {

        const result = await noormJson<TableSummary[]>(project, 'db', 'explore', 'tables');

        expect(result.ok).toBe(true);

        const tableNames = result.data!.map((t) => t.name);
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('todo_lists');
        expect(tableNames).toContain('todo_items');

        // Each table should have a column count
        for (const table of result.data!) {

            expect(typeof table.columnCount).toBe('number');
            expect(table.columnCount).toBeGreaterThan(0);

        }

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: db/explore/tables/detail
// ─────────────────────────────────────────────────────────────

describe('cli: db explore tables detail', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'db', 'explore', 'tables', 'detail', 'users');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should return valid JSON with --json flag', async () => {

        const result = await noormJson<TableDetail>(project, 'db', 'explore', 'tables', 'detail', 'users');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.data!.name).toBe('users');

    });

    it('should show columns with types', async () => {

        const result = await noormJson<TableDetail>(project, 'db', 'explore', 'tables', 'detail', 'users');

        expect(result.ok).toBe(true);
        expect(Array.isArray(result.data!.columns)).toBe(true);
        expect(result.data!.columns.length).toBeGreaterThan(0);

        const columnNames = result.data!.columns.map((c) => c.name);
        expect(columnNames).toContain('id');
        expect(columnNames).toContain('email');
        expect(columnNames).toContain('username');

    });

    it('should fail with exit code 1 on missing table', async () => {

        const result = await noorm(project, 'db', 'explore', 'tables', 'detail', 'nonexistent');

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(1);

    });

    it('should require table name parameter', async () => {

        const result = await noorm(project, 'db', 'explore', 'tables', 'detail');

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(1);

        const output = stripAnsi(result.stdout + result.stderr);
        expect(output.toLowerCase()).toContain('name');

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: db/truncate
// ─────────────────────────────────────────────────────────────

describe('cli: db truncate', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'db', 'truncate');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should return valid JSON with --json flag', async () => {

        // Re-setup project since previous test truncated data
        await cleanupTestProject(project);
        project = await setupTestProject();

        const result = await noormJson<TruncateResult>(project, 'db', 'truncate');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(Array.isArray(result.data!.truncated)).toBe(true);

    });

    it('should truncate all tables', async () => {

        // Re-setup project since previous test truncated data
        await cleanupTestProject(project);
        project = await setupTestProject();

        const result = await noormJson<TruncateResult>(project, 'db', 'truncate');

        expect(result.ok).toBe(true);
        expect(result.data!.truncated.length).toBeGreaterThan(0);
        expect(result.data!.count).toBe(result.data!.truncated.length);

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: db/teardown
// ─────────────────────────────────────────────────────────────

describe('cli: db teardown', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'db', 'teardown');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should return valid JSON with --json flag', async () => {

        // Re-setup project since previous test tore down schema
        await cleanupTestProject(project);
        project = await setupTestProject();

        const result = await noormJson<TeardownResult>(project, 'db', 'teardown');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(typeof result.data!.dropped).toBe('object');

    });

    it('should drop all objects', async () => {

        // Re-setup project since previous test tore down schema
        await cleanupTestProject(project);
        project = await setupTestProject();

        const result = await noormJson<TeardownResult>(project, 'db', 'teardown');

        expect(result.ok).toBe(true);
        expect(result.data!.dropped.tables.length).toBeGreaterThan(0);
        expect(result.data!.count).toBeGreaterThan(0);

    });

    it('should leave database empty after teardown', async () => {

        // Re-setup project since previous test tore down schema
        await cleanupTestProject(project);
        project = await setupTestProject();

        // Teardown
        await noorm(project, 'db', 'teardown');

        // Check that overview shows 0 tables
        const overview = await noormJson<ExploreOverview>(project, 'db', 'explore');

        if (!overview.ok) {

            console.log('FLAKY DB FAILURE:', overview.error, overview._raw);

        }

        expect(overview.ok).toBe(true);
        expect(overview.data!.tables).toBe(0);
        expect(overview.data!.views).toBe(0);

    });

});

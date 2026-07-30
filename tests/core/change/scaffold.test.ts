/**
 * Change scaffold tests.
 *
 * These tests create/delete files since they test scaffolding operations.
 * Uses tmp/ directory for dynamic test files.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import { mkdir, rm, readdir, readFile, stat } from 'node:fs/promises';

import { attempt } from '@logosdx/utils';
import { Kysely, SqliteDialect } from 'kysely';

import {
    createChange,
    addFile,
    removeFile,
    renameFile,
    deleteChange,
} from '../../../src/core/change/scaffold.js';
import { parseChange } from '../../../src/core/change/parser.js';
import { executeChange } from '../../../src/core/change/executor.js';
import { ChangeValidationError } from '../../../src/core/change/types.js';
import type { ChangeContext } from '../../../src/core/change/types.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';

const TMP_DIR = path.join(process.cwd(), 'tmp/change-scaffold-test');

describe('change: scaffold', () => {

    beforeAll(async () => {

        await mkdir(TMP_DIR, { recursive: true });

    });

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true });

    });

    describe('createChange', () => {

        const createDir = path.join(TMP_DIR, 'create');

        beforeEach(async () => {

            await mkdir(createDir, { recursive: true });

        });

        afterEach(async () => {

            await rm(createDir, { recursive: true, force: true });

        });

        it('should create change with default date', async () => {

            const result = await createChange(createDir, { description: 'add-users' });

            expect(result.description).toBe('add-users');
            expect(result.date).toBeInstanceOf(Date);

            // #53: an empty change/revert pair is worse than inert - parseChange
            // rejects it and the caller sees "change not found" instead of the
            // real problem (needs editing). createChange now scaffolds a stub in
            // each folder so the changeset is runnable (once edited) from the start.
            expect(result.changeFiles).toHaveLength(1);
            expect(result.revertFiles).toHaveLength(1);
            expect(result.changeFiles[0]?.filename).toBe('001_add-users.sql');
            expect(result.revertFiles[0]?.filename).toBe('001_add-users.sql');
            expect(result.changeFiles[0]?.filename).toMatch(/^(\d{3})_(.+)\.sql$/);

            // Verify folder structure
            const entries = await readdir(result.path);
            expect(entries).toContain('change');
            expect(entries).toContain('revert');

            const changeEntries = await readdir(path.join(result.path, 'change'));
            const revertEntries = await readdir(path.join(result.path, 'revert'));
            expect(changeEntries).toContain('001_add-users.sql');
            expect(revertEntries).toContain('001_add-users.sql');

            // Stub content names what belongs in each file, and differs between
            // change/ and revert/ so it isn't ambiguous which folder is which.
            const changeContent = await readFile(result.changeFiles[0]!.path, 'utf-8');
            const revertContent = await readFile(result.revertFiles[0]!.path, 'utf-8');
            expect(changeContent).toContain('apply this change');
            expect(revertContent).toContain('undo this change');
            expect(changeContent).not.toBe(revertContent);

        });

        it('should scaffold a change that parseChange loads instead of rejecting', async () => {

            const result = await createChange(createDir, { description: 'add-users' });

            const parsed = await parseChange(result.path);

            expect(parsed.changeFiles).toHaveLength(1);
            expect(parsed.revertFiles).toHaveLength(1);

        });

        it('should create change with custom date', async () => {

            // Use local date to avoid timezone issues
            const customDate = new Date(2025, 5, 15); // June 15, 2025 in local time
            const result = await createChange(createDir, {
                description: 'custom-date-test',
                date: customDate,
            });

            expect(result.name).toBe('2025-06-15-custom-date-test');

        });

        it('should slugify description', async () => {

            const result = await createChange(createDir, {
                description: 'Add Users Table!',
            });

            expect(result.name).toContain('add-users-table');

        });

        it('should throw for duplicate change', async () => {

            // Use local date to avoid timezone issues
            const testDate = new Date(2025, 0, 1); // Jan 1, 2025 in local time

            // Create first change
            await createChange(createDir, {
                description: 'duplicate-test',
                date: testDate,
            });

            // Try to create duplicate
            await expect(
                createChange(createDir, {
                    description: 'duplicate-test',
                    date: testDate,
                }),
            ).rejects.toThrow('already exists');

        });

    });

    describe('createChange -> executeChange (issue #53)', () => {

        const runDir = path.join(TMP_DIR, 'add-then-run');

        beforeEach(async () => {

            await mkdir(runDir, { recursive: true });

        });

        afterEach(async () => {

            await rm(runDir, { recursive: true, force: true });

        });

        it('should report empty-SQL, not "change not found", for a freshly added change', async () => {

            const created = await createChange(runDir, { description: 'add-users' });

            // Mirrors #loadChange (src/core/change/manager.ts): parse the change
            // straight off disk the way `change run` does.
            const parsed = await parseChange(created.path);

            const db = new Kysely<NoormDatabase>({
                dialect: new SqliteDialect({
                    database: new BunSqliteDatabase(':memory:') as never,
                }),
            });

            await v1.up(db as Kysely<unknown>, 'sqlite');

            const context: ChangeContext = {
                db,
                configName: 'test',
                identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
                projectRoot: runDir,
                changesDir: runDir,
                sqlDir: runDir,
                access: { user: 'admin', agent: 'admin' },
                channel: 'user',
                dialect: 'sqlite',
            };

            const [, err] = await attempt(() => executeChange(context, parsed));

            expect(err).toBeInstanceOf(ChangeValidationError);
            expect(err?.message).toContain('empty or contain only template placeholders');
            expect(err?.message).not.toContain('not found');

            await db.destroy();

        });

    });

    describe('addFile', () => {

        const addDir = path.join(TMP_DIR, 'add-file');
        let change: Awaited<ReturnType<typeof createChange>>;

        beforeEach(async () => {

            await mkdir(addDir, { recursive: true });
            change = await createChange(addDir, {
                description: 'file-test',
                date: new Date(2025, 1, 1),
            });

        });

        afterEach(async () => {

            await rm(addDir, { recursive: true, force: true });

        });

        it('should add SQL file to change/ folder', async () => {

            // createChange already scaffolds 001_file-test.sql; addFile continues
            // the sequence from there.
            const updated = await addFile(change, 'change', {
                name: 'create-users-table',
                type: 'sql',
                content: 'CREATE TABLE users (id INT);',
            });

            expect(updated.changeFiles).toHaveLength(2);
            expect(updated.changeFiles[1]?.filename).toBe('002_create-users-table.sql');

            // Verify file content
            const content = await readFile(updated.changeFiles[1]!.path, 'utf-8');
            expect(content).toBe('CREATE TABLE users (id INT);');

        });

        it('should add file to revert/ folder', async () => {

            const updated = await addFile(change, 'revert', {
                name: 'drop-users-table',
                type: 'sql',
                content: 'DROP TABLE users;',
            });

            expect(updated.revertFiles).toHaveLength(2);
            expect(updated.revertFiles[1]?.filename).toBe('002_drop-users-table.sql');

        });

        it('should auto-increment sequence number', async () => {

            let updated = await addFile(change, 'change', {
                name: 'first',
                type: 'sql',
            });

            updated = await addFile(updated, 'change', {
                name: 'second',
                type: 'sql',
            });

            updated = await addFile(updated, 'change', {
                name: 'third',
                type: 'sql',
            });

            // Index 0 is the stub createChange scaffolds; addFile picks up at 002.
            expect(updated.changeFiles[0]?.filename).toBe('001_file-test.sql');
            expect(updated.changeFiles[1]?.filename).toBe('002_first.sql');
            expect(updated.changeFiles[2]?.filename).toBe('003_second.sql');
            expect(updated.changeFiles[3]?.filename).toBe('004_third.sql');

        });

        it('should create txt manifest file', async () => {

            const updated = await addFile(change, 'change', {
                name: 'schema-refs',
                type: 'txt',
                paths: ['tables/users.sql', 'views/active_users.sql'],
            });

            expect(updated.changeFiles[1]?.filename).toBe('002_schema-refs.txt');
            expect(updated.changeFiles[1]?.type).toBe('txt');

            const content = await readFile(updated.changeFiles[1]!.path, 'utf-8');
            expect(content).toBe('tables/users.sql\nviews/active_users.sql\n');

        });

        it('should throw for invalid folder', async () => {

            await expect(
                addFile(change, 'invalid' as 'change', { name: 'test', type: 'sql' }),
            ).rejects.toThrow();

        });

    });

    describe('removeFile', () => {

        const removeDir = path.join(TMP_DIR, 'remove-file');
        let change: Awaited<ReturnType<typeof createChange>>;

        beforeEach(async () => {

            await mkdir(removeDir, { recursive: true });
            change = await createChange(removeDir, {
                description: 'remove-test',
                date: new Date(2025, 2, 1),
            });

            // Add some files (001_remove-test.sql is createChange's scaffolded stub)
            change = await addFile(change, 'change', { name: 'first', type: 'sql' });
            change = await addFile(change, 'change', { name: 'second', type: 'sql' });
            change = await addFile(change, 'change', { name: 'third', type: 'sql' });

        });

        afterEach(async () => {

            await rm(removeDir, { recursive: true, force: true });

        });

        it('should remove file from change', async () => {

            const updated = await removeFile(change, 'change', '003_second.sql');

            expect(updated.changeFiles).toHaveLength(3);
            expect(
                updated.changeFiles.find((f) => f.filename === '003_second.sql'),
            ).toBeUndefined();

            // Verify file is deleted
            const entries = await readdir(path.join(change.path, 'change'));
            expect(entries).not.toContain('003_second.sql');

        });

        it('should throw for nonexistent file', async () => {

            await expect(removeFile(change, 'change', 'nonexistent.sql')).rejects.toThrow(
                ChangeValidationError,
            );

        });

    });

    describe('renameFile', () => {

        const renameDir = path.join(TMP_DIR, 'rename-file');
        let change: Awaited<ReturnType<typeof createChange>>;

        beforeEach(async () => {

            await mkdir(renameDir, { recursive: true });
            change = await createChange(renameDir, {
                description: 'rename-test',
                date: new Date(2025, 3, 1),
            });

            // 001_rename-test.sql is createChange's scaffolded stub; this lands at 002.
            change = await addFile(change, 'change', {
                name: 'old-name',
                type: 'sql',
                content: 'SELECT 1;',
            });

        });

        afterEach(async () => {

            await rm(renameDir, { recursive: true, force: true });

        });

        it('should rename file preserving sequence number', async () => {

            const updated = await renameFile(change, 'change', '002_old-name.sql', 'new-name');

            const renamed = updated.changeFiles.find((f) => f.filename === '002_new-name.sql');
            expect(renamed).toBeDefined();

            // Verify file exists with new name
            const entries = await readdir(path.join(change.path, 'change'));
            expect(entries).toContain('002_new-name.sql');
            expect(entries).not.toContain('002_old-name.sql');

            // Verify content preserved
            const content = await readFile(renamed!.path, 'utf-8');
            expect(content).toBe('SELECT 1;');

        });

        it('should throw for nonexistent file', async () => {

            await expect(
                renameFile(change, 'change', 'nonexistent.sql', 'new-name'),
            ).rejects.toThrow(ChangeValidationError);

        });

    });

    describe('deleteChange', () => {

        const deleteDir = path.join(TMP_DIR, 'delete-cs');

        beforeEach(async () => {

            await mkdir(deleteDir, { recursive: true });

        });

        afterEach(async () => {

            await rm(deleteDir, { recursive: true, force: true });

        });

        it('should delete entire change folder', async () => {

            // Create change with files
            let change = await createChange(deleteDir, {
                description: 'to-delete',
                date: new Date(2025, 4, 1),
            });

            change = await addFile(change, 'change', {
                name: 'test',
                type: 'sql',
                content: 'SELECT 1;',
            });

            const csPath = change.path;

            // Verify it exists
            const statBefore = await stat(csPath);
            expect(statBefore.isDirectory()).toBe(true);

            // Delete
            await deleteChange(change);

            // Verify deleted
            await expect(stat(csPath)).rejects.toThrow();

        });

    });

});

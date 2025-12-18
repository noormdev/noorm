/**
 * Changeset scaffold tests.
 *
 * These tests create/delete files since they test scaffolding operations.
 * Uses tmp/ directory for dynamic test files.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { mkdir, rm, readdir, readFile, stat } from 'node:fs/promises'
import {
    createChangeset,
    addFile,
    removeFile,
    renameFile,
    deleteChangeset,
} from '../../../src/core/changeset/scaffold.js'
import {
    ChangesetValidationError,
} from '../../../src/core/changeset/types.js'


const TMP_DIR = path.join(process.cwd(), 'tmp/changeset-scaffold-test')


describe('changeset: scaffold', () => {

    beforeAll(async () => {

        await mkdir(TMP_DIR, { recursive: true })
    })

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true })
    })


    describe('createChangeset', () => {

        const createDir = path.join(TMP_DIR, 'create')

        beforeEach(async () => {

            await mkdir(createDir, { recursive: true })
        })

        afterEach(async () => {

            await rm(createDir, { recursive: true, force: true })
        })

        it('should create changeset with default date', async () => {

            const result = await createChangeset(createDir, { description: 'add-users' })

            expect(result.description).toBe('add-users')
            expect(result.date).toBeInstanceOf(Date)
            expect(result.changeFiles).toHaveLength(0)
            expect(result.revertFiles).toHaveLength(0)

            // Verify folder structure
            const entries = await readdir(result.path)
            expect(entries).toContain('change')
            expect(entries).toContain('revert')
        })

        it('should create changeset with custom date', async () => {

            // Use local date to avoid timezone issues
            const customDate = new Date(2025, 5, 15) // June 15, 2025 in local time
            const result = await createChangeset(createDir, {
                description: 'custom-date-test',
                date: customDate,
            })

            expect(result.name).toBe('2025-06-15-custom-date-test')
        })

        it('should slugify description', async () => {

            const result = await createChangeset(createDir, {
                description: 'Add Users Table!',
            })

            expect(result.name).toContain('add-users-table')
        })

        it('should throw for duplicate changeset', async () => {

            // Use local date to avoid timezone issues
            const testDate = new Date(2025, 0, 1) // Jan 1, 2025 in local time

            // Create first changeset
            await createChangeset(createDir, {
                description: 'duplicate-test',
                date: testDate,
            })

            // Try to create duplicate
            await expect(
                createChangeset(createDir, {
                    description: 'duplicate-test',
                    date: testDate,
                })
            ).rejects.toThrow('already exists')
        })
    })


    describe('addFile', () => {

        const addDir = path.join(TMP_DIR, 'add-file')
        let changeset: Awaited<ReturnType<typeof createChangeset>>

        beforeEach(async () => {

            await mkdir(addDir, { recursive: true })
            changeset = await createChangeset(addDir, {
                description: 'file-test',
                date: new Date(2025, 1, 1),
            })
        })

        afterEach(async () => {

            await rm(addDir, { recursive: true, force: true })
        })

        it('should add SQL file to change/ folder', async () => {

            const updated = await addFile(changeset, 'change', {
                name: 'create-users-table',
                type: 'sql',
                content: 'CREATE TABLE users (id INT);',
            })

            expect(updated.changeFiles).toHaveLength(1)
            expect(updated.changeFiles[0]?.filename).toBe('001_create-users-table.sql')

            // Verify file content
            const content = await readFile(updated.changeFiles[0]!.path, 'utf-8')
            expect(content).toBe('CREATE TABLE users (id INT);')
        })

        it('should add file to revert/ folder', async () => {

            const updated = await addFile(changeset, 'revert', {
                name: 'drop-users-table',
                type: 'sql',
                content: 'DROP TABLE users;',
            })

            expect(updated.revertFiles).toHaveLength(1)
            expect(updated.revertFiles[0]?.filename).toBe('001_drop-users-table.sql')
        })

        it('should auto-increment sequence number', async () => {

            let updated = await addFile(changeset, 'change', {
                name: 'first',
                type: 'sql',
            })

            updated = await addFile(updated, 'change', {
                name: 'second',
                type: 'sql',
            })

            updated = await addFile(updated, 'change', {
                name: 'third',
                type: 'sql',
            })

            expect(updated.changeFiles[0]?.filename).toBe('001_first.sql')
            expect(updated.changeFiles[1]?.filename).toBe('002_second.sql')
            expect(updated.changeFiles[2]?.filename).toBe('003_third.sql')
        })

        it('should create txt manifest file', async () => {

            const updated = await addFile(changeset, 'change', {
                name: 'schema-refs',
                type: 'txt',
                paths: ['tables/users.sql', 'views/active_users.sql'],
            })

            expect(updated.changeFiles[0]?.filename).toBe('001_schema-refs.txt')
            expect(updated.changeFiles[0]?.type).toBe('txt')

            const content = await readFile(updated.changeFiles[0]!.path, 'utf-8')
            expect(content).toBe('tables/users.sql\nviews/active_users.sql\n')
        })

        it('should throw for invalid folder', async () => {

            await expect(
                addFile(changeset, 'invalid' as 'change', { name: 'test', type: 'sql' })
            ).rejects.toThrow()
        })
    })


    describe('removeFile', () => {

        const removeDir = path.join(TMP_DIR, 'remove-file')
        let changeset: Awaited<ReturnType<typeof createChangeset>>

        beforeEach(async () => {

            await mkdir(removeDir, { recursive: true })
            changeset = await createChangeset(removeDir, {
                description: 'remove-test',
                date: new Date(2025, 2, 1),
            })

            // Add some files
            changeset = await addFile(changeset, 'change', { name: 'first', type: 'sql' })
            changeset = await addFile(changeset, 'change', { name: 'second', type: 'sql' })
            changeset = await addFile(changeset, 'change', { name: 'third', type: 'sql' })
        })

        afterEach(async () => {

            await rm(removeDir, { recursive: true, force: true })
        })

        it('should remove file from changeset', async () => {

            const updated = await removeFile(changeset, 'change', '002_second.sql')

            expect(updated.changeFiles).toHaveLength(2)
            expect(updated.changeFiles.find(f => f.filename === '002_second.sql')).toBeUndefined()

            // Verify file is deleted
            const entries = await readdir(path.join(changeset.path, 'change'))
            expect(entries).not.toContain('002_second.sql')
        })

        it('should throw for nonexistent file', async () => {

            await expect(
                removeFile(changeset, 'change', 'nonexistent.sql')
            ).rejects.toThrow(ChangesetValidationError)
        })
    })


    describe('renameFile', () => {

        const renameDir = path.join(TMP_DIR, 'rename-file')
        let changeset: Awaited<ReturnType<typeof createChangeset>>

        beforeEach(async () => {

            await mkdir(renameDir, { recursive: true })
            changeset = await createChangeset(renameDir, {
                description: 'rename-test',
                date: new Date(2025, 3, 1),
            })

            changeset = await addFile(changeset, 'change', {
                name: 'old-name',
                type: 'sql',
                content: 'SELECT 1;',
            })
        })

        afterEach(async () => {

            await rm(renameDir, { recursive: true, force: true })
        })

        it('should rename file preserving sequence number', async () => {

            const updated = await renameFile(changeset, 'change', '001_old-name.sql', 'new-name')

            expect(updated.changeFiles[0]?.filename).toBe('001_new-name.sql')

            // Verify file exists with new name
            const entries = await readdir(path.join(changeset.path, 'change'))
            expect(entries).toContain('001_new-name.sql')
            expect(entries).not.toContain('001_old-name.sql')

            // Verify content preserved
            const content = await readFile(updated.changeFiles[0]!.path, 'utf-8')
            expect(content).toBe('SELECT 1;')
        })

        it('should throw for nonexistent file', async () => {

            await expect(
                renameFile(changeset, 'change', 'nonexistent.sql', 'new-name')
            ).rejects.toThrow(ChangesetValidationError)
        })
    })


    describe('deleteChangeset', () => {

        const deleteDir = path.join(TMP_DIR, 'delete-cs')

        beforeEach(async () => {

            await mkdir(deleteDir, { recursive: true })
        })

        afterEach(async () => {

            await rm(deleteDir, { recursive: true, force: true })
        })

        it('should delete entire changeset folder', async () => {

            // Create changeset with files
            let changeset = await createChangeset(deleteDir, {
                description: 'to-delete',
                date: new Date(2025, 4, 1),
            })

            changeset = await addFile(changeset, 'change', {
                name: 'test',
                type: 'sql',
                content: 'SELECT 1;',
            })

            const csPath = changeset.path

            // Verify it exists
            const statBefore = await stat(csPath)
            expect(statBefore.isDirectory()).toBe(true)

            // Delete
            await deleteChangeset(changeset)

            // Verify deleted
            await expect(stat(csPath)).rejects.toThrow()
        })
    })
})

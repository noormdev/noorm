/**
 * Change parser tests.
 *
 * Uses permanent fixture files in ./fixtures/ for testing.
 * See fixtures/changes/ for example change structures.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    parseChange,
    discoverChanges,
    resolveManifest,
    validateChange,
    hasRevertFiles,
    parseSequence,
    parseDescription,
} from '../../../src/core/change/parser.js';
import {
    ChangeNotFoundError,
    ChangeValidationError,
    ManifestReferenceError,
} from '../../../src/core/change/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const CHANGESETS_DIR = path.join(FIXTURES_DIR, 'changes');
const SCHEMA_DIR = path.join(FIXTURES_DIR, 'schema');
const MANIFESTS_DIR = path.join(FIXTURES_DIR, 'manifests');

describe('change: parser', () => {

    describe('parseChange', () => {

        it('should parse a valid change with date prefix', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-01-15-add-users');

            const result = await parseChange(csDir);

            expect(result.name).toBe('2025-01-15-add-users');
            expect(result.date).toBeInstanceOf(Date);
            expect(result.date?.toISOString().startsWith('2025-01-15')).toBe(true);
            expect(result.description).toBe('add-users');
            expect(result.changeFiles).toHaveLength(1);
            expect(result.changeFiles[0]?.filename).toBe('001_create-table.sql');
            expect(result.changeFiles[0]?.type).toBe('sql');
            expect(result.revertFiles).toHaveLength(0);
            expect(result.hasChangelog).toBe(false);

        });

        it('should parse change without date prefix', async () => {

            const csDir = path.join(CHANGESETS_DIR, 'init-schema');

            const result = await parseChange(csDir);

            expect(result.name).toBe('init-schema');
            expect(result.date).toBeNull();
            expect(result.description).toBe('init-schema');

        });

        it('should parse change with revert folder', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-02-01-add-posts');

            const result = await parseChange(csDir);

            expect(result.changeFiles).toHaveLength(1);
            expect(result.revertFiles).toHaveLength(1);
            expect(result.revertFiles[0]?.filename).toBe('001_drop.sql');

        });

        it('should detect changelog.md', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-03-01-with-changelog');

            const result = await parseChange(csDir);

            expect(result.hasChangelog).toBe(true);

        });

        it('should parse .sql.tmpl files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-04-01-templates');

            const result = await parseChange(csDir);

            expect(result.changeFiles[0]?.filename).toBe('001_dynamic.sql.tmpl');
            expect(result.changeFiles[0]?.type).toBe('sql');

        });

        it('should parse .txt manifest files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-05-01-manifests');

            const result = await parseChange(csDir);

            expect(result.changeFiles[0]?.filename).toBe('001_refs.txt');
            expect(result.changeFiles[0]?.type).toBe('txt');

        });

        it('should sort files by filename', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-06-01-sorted');

            const result = await parseChange(csDir);

            expect(result.changeFiles[0]?.filename).toBe('001_first.sql');
            expect(result.changeFiles[1]?.filename).toBe('002_second.sql');
            expect(result.changeFiles[2]?.filename).toBe('003_third.sql');

        });

        it('should throw ChangeNotFoundError for missing folder', async () => {

            const csDir = path.join(CHANGESETS_DIR, 'nonexistent');

            await expect(parseChange(csDir)).rejects.toThrow(ChangeNotFoundError);

        });

        it('should throw ChangeValidationError for empty change', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-07-01-empty');

            await expect(parseChange(csDir)).rejects.toThrow(ChangeValidationError);

        });

        it('should throw ChangeValidationError for change with empty change folder', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-08-01-empty-change');

            await expect(parseChange(csDir)).rejects.toThrow(ChangeValidationError);

        });

    });

    describe('discoverChanges', () => {

        it('should discover all valid changes', async () => {

            const results = await discoverChanges(CHANGESETS_DIR);

            // Should find all valid changes (those with files in change/ or revert/)
            const validNames = results.map((r) => r.name);

            expect(validNames).toContain('2025-01-15-add-users');
            expect(validNames).toContain('2025-02-01-add-posts');
            expect(validNames).toContain('2025-03-01-with-changelog');
            expect(validNames).toContain('init-schema');

        });

        it('should return empty array for nonexistent directory', async () => {

            const results = await discoverChanges(path.join(CHANGESETS_DIR, 'nonexistent'));

            expect(results).toEqual([]);

        });

        it('should skip invalid changes', async () => {

            const results = await discoverChanges(CHANGESETS_DIR);

            // Empty changes should be skipped
            const names = results.map((r) => r.name);
            expect(names).not.toContain('2025-07-01-empty');
            expect(names).not.toContain('2025-08-01-empty-change');

        });

        it('should sort changes by name', async () => {

            const results = await discoverChanges(CHANGESETS_DIR);

            // Verify sorted order
            for (let i = 1; i < results.length; i++) {

                const prev = results[i - 1]?.name ?? '';
                const curr = results[i]?.name ?? '';
                expect(prev.localeCompare(curr)).toBeLessThan(0);

            }

        });

    });

    describe('resolveManifest', () => {

        it('should resolve manifest file paths', async () => {

            const manifestPath = path.join(MANIFESTS_DIR, 'refs.txt');

            const paths = await resolveManifest(manifestPath, SCHEMA_DIR);

            expect(paths).toHaveLength(2);
            expect(paths).toContain(path.join(SCHEMA_DIR, 'tables', 'users.sql'));
            expect(paths).toContain(path.join(SCHEMA_DIR, 'views', 'active_users.sql'));

        });

        it('should skip comments and empty lines', async () => {

            const manifestPath = path.join(MANIFESTS_DIR, 'comments.txt');

            const paths = await resolveManifest(manifestPath, SCHEMA_DIR);

            expect(paths).toHaveLength(1);
            expect(paths[0]).toBe(path.join(SCHEMA_DIR, 'tables', 'users.sql'));

        });

        it('should sort resolved paths alphabetically', async () => {

            const manifestPath = path.join(MANIFESTS_DIR, 'unsorted.txt');

            const paths = await resolveManifest(manifestPath, SCHEMA_DIR);

            expect(paths[0]).toContain('a.sql');
            expect(paths[1]).toContain('b.sql');
            expect(paths[2]).toContain('c.sql');

        });

        it('should throw ManifestReferenceError for missing file', async () => {

            const manifestPath = path.join(MANIFESTS_DIR, 'missing-ref.txt');

            await expect(resolveManifest(manifestPath, SCHEMA_DIR)).rejects.toThrow(
                ManifestReferenceError,
            );

        });

        it('should throw ChangeValidationError for empty manifest', async () => {

            const manifestPath = path.join(MANIFESTS_DIR, 'empty.txt');

            await expect(resolveManifest(manifestPath, SCHEMA_DIR)).rejects.toThrow(
                ChangeValidationError,
            );

        });

    });

    describe('validateChange', () => {

        it('should pass for valid change', () => {

            const change = {
                name: 'test',
                path: '/test',
                date: null,
                description: 'test',
                changeFiles: [
                    { filename: '001_a.sql', path: '/test/change/001_a.sql', type: 'sql' as const },
                    { filename: '002_b.sql', path: '/test/change/002_b.sql', type: 'sql' as const },
                ],
                revertFiles: [],
                hasChangelog: false,
            };

            expect(() => validateChange(change)).not.toThrow();

        });

        it('should throw for duplicate filenames in change/', () => {

            const change = {
                name: 'test',
                path: '/test',
                date: null,
                description: 'test',
                changeFiles: [
                    {
                        filename: '001_dup.sql',
                        path: '/test/change/001_dup.sql',
                        type: 'sql' as const,
                    },
                    {
                        filename: '001_dup.sql',
                        path: '/test/change/001_dup.sql',
                        type: 'sql' as const,
                    },
                ],
                revertFiles: [],
                hasChangelog: false,
            };

            expect(() => validateChange(change)).toThrow(ChangeValidationError);

        });

        it('should throw for duplicate filenames in revert/', () => {

            const change = {
                name: 'test',
                path: '/test',
                date: null,
                description: 'test',
                changeFiles: [],
                revertFiles: [
                    {
                        filename: '001_dup.sql',
                        path: '/test/revert/001_dup.sql',
                        type: 'sql' as const,
                    },
                    {
                        filename: '001_dup.sql',
                        path: '/test/revert/001_dup.sql',
                        type: 'sql' as const,
                    },
                ],
                hasChangelog: false,
            };

            expect(() => validateChange(change)).toThrow(ChangeValidationError);

        });

    });

    describe('hasRevertFiles', () => {

        it('should return true if change has revert files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-02-01-add-posts');
            const change = await parseChange(csDir);

            expect(hasRevertFiles(change)).toBe(true);

        });

        it('should return false if change has no revert files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-01-15-add-users');
            const change = await parseChange(csDir);

            expect(hasRevertFiles(change)).toBe(false);

        });

    });

    describe('parseSequence', () => {

        it('should extract sequence number from valid filename', () => {

            expect(parseSequence('001_create-table.sql')).toBe(1);
            expect(parseSequence('042_update-index.sql')).toBe(42);
            expect(parseSequence('100_final-step.sql.tmpl')).toBe(100);

        });

        it('should return null for invalid filename', () => {

            expect(parseSequence('no-sequence.sql')).toBeNull();
            expect(parseSequence('01_too-short.sql')).toBeNull();
            expect(parseSequence('1234_too-long.sql')).toBeNull();

        });

    });

    describe('parseDescription', () => {

        it('should extract description from sequenced filename', () => {

            expect(parseDescription('001_create-users-table.sql')).toBe('create-users-table');
            expect(parseDescription('002_add-index.sql.tmpl')).toBe('add-index');
            expect(parseDescription('003_refs.txt')).toBe('refs');

        });

        it('should return entire name if no sequence', () => {

            expect(parseDescription('no-sequence.sql')).toBe('no-sequence');
            expect(parseDescription('plain-file.txt')).toBe('plain-file');

        });

    });

});

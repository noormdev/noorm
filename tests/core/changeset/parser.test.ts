/**
 * Changeset parser tests.
 *
 * Uses permanent fixture files in ./fixtures/ for testing.
 * See fixtures/changesets/ for example changeset structures.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    parseChangeset,
    discoverChangesets,
    resolveManifest,
    validateChangeset,
    hasRevertFiles,
    parseSequence,
    parseDescription,
} from '../../../src/core/changeset/parser.js';
import {
    ChangesetNotFoundError,
    ChangesetValidationError,
    ManifestReferenceError,
} from '../../../src/core/changeset/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const CHANGESETS_DIR = path.join(FIXTURES_DIR, 'changesets');
const SCHEMA_DIR = path.join(FIXTURES_DIR, 'schema');
const MANIFESTS_DIR = path.join(FIXTURES_DIR, 'manifests');

describe('changeset: parser', () => {

    describe('parseChangeset', () => {

        it('should parse a valid changeset with date prefix', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-01-15-add-users');

            const result = await parseChangeset(csDir);

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

        it('should parse changeset without date prefix', async () => {

            const csDir = path.join(CHANGESETS_DIR, 'init-schema');

            const result = await parseChangeset(csDir);

            expect(result.name).toBe('init-schema');
            expect(result.date).toBeNull();
            expect(result.description).toBe('init-schema');

        });

        it('should parse changeset with revert folder', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-02-01-add-posts');

            const result = await parseChangeset(csDir);

            expect(result.changeFiles).toHaveLength(1);
            expect(result.revertFiles).toHaveLength(1);
            expect(result.revertFiles[0]?.filename).toBe('001_drop.sql');

        });

        it('should detect changelog.md', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-03-01-with-changelog');

            const result = await parseChangeset(csDir);

            expect(result.hasChangelog).toBe(true);

        });

        it('should parse .sql.tmpl files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-04-01-templates');

            const result = await parseChangeset(csDir);

            expect(result.changeFiles[0]?.filename).toBe('001_dynamic.sql.tmpl');
            expect(result.changeFiles[0]?.type).toBe('sql');

        });

        it('should parse .txt manifest files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-05-01-manifests');

            const result = await parseChangeset(csDir);

            expect(result.changeFiles[0]?.filename).toBe('001_refs.txt');
            expect(result.changeFiles[0]?.type).toBe('txt');

        });

        it('should sort files by filename', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-06-01-sorted');

            const result = await parseChangeset(csDir);

            expect(result.changeFiles[0]?.filename).toBe('001_first.sql');
            expect(result.changeFiles[1]?.filename).toBe('002_second.sql');
            expect(result.changeFiles[2]?.filename).toBe('003_third.sql');

        });

        it('should throw ChangesetNotFoundError for missing folder', async () => {

            const csDir = path.join(CHANGESETS_DIR, 'nonexistent');

            await expect(parseChangeset(csDir)).rejects.toThrow(ChangesetNotFoundError);

        });

        it('should throw ChangesetValidationError for empty changeset', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-07-01-empty');

            await expect(parseChangeset(csDir)).rejects.toThrow(ChangesetValidationError);

        });

        it('should throw ChangesetValidationError for changeset with empty change folder', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-08-01-empty-change');

            await expect(parseChangeset(csDir)).rejects.toThrow(ChangesetValidationError);

        });

    });

    describe('discoverChangesets', () => {

        it('should discover all valid changesets', async () => {

            const results = await discoverChangesets(CHANGESETS_DIR);

            // Should find all valid changesets (those with files in change/ or revert/)
            const validNames = results.map((r) => r.name);

            expect(validNames).toContain('2025-01-15-add-users');
            expect(validNames).toContain('2025-02-01-add-posts');
            expect(validNames).toContain('2025-03-01-with-changelog');
            expect(validNames).toContain('init-schema');

        });

        it('should return empty array for nonexistent directory', async () => {

            const results = await discoverChangesets(path.join(CHANGESETS_DIR, 'nonexistent'));

            expect(results).toEqual([]);

        });

        it('should skip invalid changesets', async () => {

            const results = await discoverChangesets(CHANGESETS_DIR);

            // Empty changesets should be skipped
            const names = results.map((r) => r.name);
            expect(names).not.toContain('2025-07-01-empty');
            expect(names).not.toContain('2025-08-01-empty-change');

        });

        it('should sort changesets by name', async () => {

            const results = await discoverChangesets(CHANGESETS_DIR);

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

        it('should throw ChangesetValidationError for empty manifest', async () => {

            const manifestPath = path.join(MANIFESTS_DIR, 'empty.txt');

            await expect(resolveManifest(manifestPath, SCHEMA_DIR)).rejects.toThrow(
                ChangesetValidationError,
            );

        });

    });

    describe('validateChangeset', () => {

        it('should pass for valid changeset', () => {

            const changeset = {
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

            expect(() => validateChangeset(changeset)).not.toThrow();

        });

        it('should throw for duplicate filenames in change/', () => {

            const changeset = {
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

            expect(() => validateChangeset(changeset)).toThrow(ChangesetValidationError);

        });

        it('should throw for duplicate filenames in revert/', () => {

            const changeset = {
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

            expect(() => validateChangeset(changeset)).toThrow(ChangesetValidationError);

        });

    });

    describe('hasRevertFiles', () => {

        it('should return true if changeset has revert files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-02-01-add-posts');
            const changeset = await parseChangeset(csDir);

            expect(hasRevertFiles(changeset)).toBe(true);

        });

        it('should return false if changeset has no revert files', async () => {

            const csDir = path.join(CHANGESETS_DIR, '2025-01-15-add-users');
            const changeset = await parseChangeset(csDir);

            expect(hasRevertFiles(changeset)).toBe(false);

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

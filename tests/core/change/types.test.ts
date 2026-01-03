/**
 * Change types tests.
 */
import { describe, it, expect } from 'vitest';
import {
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    ManifestReferenceError,
    DEFAULT_CHANGE_OPTIONS,
    DEFAULT_BATCH_OPTIONS,
} from '../../../src/core/change/types.js';

describe('change: types', () => {

    describe('ChangeValidationError', () => {

        it('should create error with change name and issue', () => {

            const error = new ChangeValidationError('2024-01-01-test', 'Missing change/ folder');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangeValidationError');
            expect(error.changeName).toBe('2024-01-01-test');
            expect(error.issue).toBe('Missing change/ folder');
            expect(error.message).toBe(
                "Invalid change '2024-01-01-test': Missing change/ folder",
            );

        });

    });

    describe('ChangeNotFoundError', () => {

        it('should create error with change name', () => {

            const error = new ChangeNotFoundError('nonexistent-change');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangeNotFoundError');
            expect(error.changeName).toBe('nonexistent-change');
            expect(error.message).toBe('Change not found: nonexistent-change');

        });

    });

    describe('ChangeAlreadyAppliedError', () => {

        it('should create error with change name and applied date', () => {

            const appliedAt = new Date('2024-01-15T10:30:00Z');
            const error = new ChangeAlreadyAppliedError('2024-01-01-test', appliedAt);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangeAlreadyAppliedError');
            expect(error.changeName).toBe('2024-01-01-test');
            expect(error.appliedAt).toBe(appliedAt);
            expect(error.message).toBe(
                "Change '2024-01-01-test' already applied at 2024-01-15T10:30:00.000Z",
            );

        });

    });

    describe('ChangeNotAppliedError', () => {

        it('should create error with change name', () => {

            const error = new ChangeNotAppliedError('2024-01-01-test');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangeNotAppliedError');
            expect(error.changeName).toBe('2024-01-01-test');
            expect(error.message).toBe("Cannot revert '2024-01-01-test': not applied");

        });

    });

    describe('ChangeOrphanedError', () => {

        it('should create error with change name', () => {

            const error = new ChangeOrphanedError('old-deleted-change');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangeOrphanedError');
            expect(error.changeName).toBe('old-deleted-change');
            expect(error.message).toBe(
                "Change 'old-deleted-change' is orphaned (folder deleted from disk)",
            );

        });

    });

    describe('ManifestReferenceError', () => {

        it('should create error with manifest path and missing path', () => {

            const error = new ManifestReferenceError(
                '/project/changes/change/001_refs.txt',
                'sql/nonexistent.sql',
            );

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ManifestReferenceError');
            expect(error.manifestPath).toBe('/project/changes/change/001_refs.txt');
            expect(error.missingPath).toBe('sql/nonexistent.sql');
            expect(error.message).toBe(
                "Manifest '/project/changes/change/001_refs.txt' references missing file: sql/nonexistent.sql",
            );

        });

    });

    describe('DEFAULT_CHANGE_OPTIONS', () => {

        it('should have expected defaults', () => {

            expect(DEFAULT_CHANGE_OPTIONS.force).toBe(false);
            expect(DEFAULT_CHANGE_OPTIONS.dryRun).toBe(false);
            expect(DEFAULT_CHANGE_OPTIONS.preview).toBe(false);
            expect(DEFAULT_CHANGE_OPTIONS.output).toBe(null);

        });

    });

    describe('DEFAULT_BATCH_OPTIONS', () => {

        it('should have expected defaults', () => {

            expect(DEFAULT_BATCH_OPTIONS.force).toBe(false);
            expect(DEFAULT_BATCH_OPTIONS.dryRun).toBe(false);
            expect(DEFAULT_BATCH_OPTIONS.preview).toBe(false);
            expect(DEFAULT_BATCH_OPTIONS.output).toBe(null);
            expect(DEFAULT_BATCH_OPTIONS.abortOnError).toBe(true);

        });

    });

});

/**
 * Changeset types tests.
 */
import { describe, it, expect } from 'vitest';
import {
    ChangesetValidationError,
    ChangesetNotFoundError,
    ChangesetAlreadyAppliedError,
    ChangesetNotAppliedError,
    ChangesetOrphanedError,
    ManifestReferenceError,
    DEFAULT_CHANGESET_OPTIONS,
    DEFAULT_BATCH_OPTIONS,
} from '../../../src/core/changeset/types.js';

describe('changeset: types', () => {

    describe('ChangesetValidationError', () => {

        it('should create error with changeset name and issue', () => {

            const error = new ChangesetValidationError('2024-01-01-test', 'Missing change/ folder');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangesetValidationError');
            expect(error.changesetName).toBe('2024-01-01-test');
            expect(error.issue).toBe('Missing change/ folder');
            expect(error.message).toBe(
                "Invalid changeset '2024-01-01-test': Missing change/ folder",
            );

        });

    });

    describe('ChangesetNotFoundError', () => {

        it('should create error with changeset name', () => {

            const error = new ChangesetNotFoundError('nonexistent-changeset');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangesetNotFoundError');
            expect(error.changesetName).toBe('nonexistent-changeset');
            expect(error.message).toBe('Changeset not found: nonexistent-changeset');

        });

    });

    describe('ChangesetAlreadyAppliedError', () => {

        it('should create error with changeset name and applied date', () => {

            const appliedAt = new Date('2024-01-15T10:30:00Z');
            const error = new ChangesetAlreadyAppliedError('2024-01-01-test', appliedAt);

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangesetAlreadyAppliedError');
            expect(error.changesetName).toBe('2024-01-01-test');
            expect(error.appliedAt).toBe(appliedAt);
            expect(error.message).toBe(
                "Changeset '2024-01-01-test' already applied at 2024-01-15T10:30:00.000Z",
            );

        });

    });

    describe('ChangesetNotAppliedError', () => {

        it('should create error with changeset name', () => {

            const error = new ChangesetNotAppliedError('2024-01-01-test');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangesetNotAppliedError');
            expect(error.changesetName).toBe('2024-01-01-test');
            expect(error.message).toBe("Cannot revert '2024-01-01-test': not applied");

        });

    });

    describe('ChangesetOrphanedError', () => {

        it('should create error with changeset name', () => {

            const error = new ChangesetOrphanedError('old-deleted-changeset');

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ChangesetOrphanedError');
            expect(error.changesetName).toBe('old-deleted-changeset');
            expect(error.message).toBe(
                "Changeset 'old-deleted-changeset' is orphaned (folder deleted from disk)",
            );

        });

    });

    describe('ManifestReferenceError', () => {

        it('should create error with manifest path and missing path', () => {

            const error = new ManifestReferenceError(
                '/project/changesets/change/001_refs.txt',
                'schema/nonexistent.sql',
            );

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ManifestReferenceError');
            expect(error.manifestPath).toBe('/project/changesets/change/001_refs.txt');
            expect(error.missingPath).toBe('schema/nonexistent.sql');
            expect(error.message).toBe(
                "Manifest '/project/changesets/change/001_refs.txt' references missing file: schema/nonexistent.sql",
            );

        });

    });

    describe('DEFAULT_CHANGESET_OPTIONS', () => {

        it('should have expected defaults', () => {

            expect(DEFAULT_CHANGESET_OPTIONS.force).toBe(false);
            expect(DEFAULT_CHANGESET_OPTIONS.dryRun).toBe(false);
            expect(DEFAULT_CHANGESET_OPTIONS.preview).toBe(false);
            expect(DEFAULT_CHANGESET_OPTIONS.output).toBe(null);

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

import { describe, it, expect } from 'bun:test';

import { decideNeedsRun } from '../../../src/core/runner/tracker.js';
import type { ExecutionRecord, NeedsRunResult } from '../../../src/core/runner/types.js';

const success: ExecutionRecord = {
    checksum: 'abc123',
    exec_status: 'success',
    skip_reason: '',
    change_status: 'success',
};

describe('runner: decideNeedsRun', () => {

    it('should run on force even when the record says unchanged', () => {

        const result: NeedsRunResult = decideNeedsRun(success, 'abc123', true);

        expect(result).toEqual({ needsRun: true, reason: 'force' });

    });

    it('should run with reason error when the lookup failed', () => {

        expect(decideNeedsRun(new Error('db down'), 'abc123', false)).toEqual({ needsRun: true, reason: 'error' });

    });

    it('should run a file with no record as new', () => {

        expect(decideNeedsRun(undefined, 'abc123', false)).toEqual({ needsRun: true, reason: 'new' });

    });

    it('should retry a failed file', () => {

        const record: ExecutionRecord = { ...success, exec_status: 'failed' };

        expect(decideNeedsRun(record, 'abc123', false)).toEqual({
            needsRun: true,
            reason: 'failed',
            previousChecksum: 'abc123',
        });

    });

    it('should run a file whose newest row is a pending placeholder', () => {

        const record: ExecutionRecord = { ...success, exec_status: 'pending' };

        expect(decideNeedsRun(record, 'abc123', false)).toEqual({ needsRun: true, reason: 'new' });

    });

    it('should run a file cascade-skipped by an earlier failure', () => {

        const record: ExecutionRecord = {
            ...success,
            exec_status: 'skipped',
            skip_reason: 'Skipped: failure in 000_first.sql',
        };

        expect(decideNeedsRun(record, 'abc123', false)).toEqual({ needsRun: true, reason: 'new' });

    });

    it('should run a file whose parent change is stale', () => {

        const record: ExecutionRecord = { ...success, change_status: 'stale' };

        expect(decideNeedsRun(record, 'abc123', false)).toEqual({
            needsRun: true,
            reason: 'stale',
            previousChecksum: 'abc123',
        });

    });

    it('should run a file whose checksum changed', () => {

        expect(decideNeedsRun(success, 'def456', false)).toEqual({
            needsRun: true,
            reason: 'changed',
            previousChecksum: 'abc123',
        });

    });

    it('should skip an unchanged file', () => {

        expect(decideNeedsRun(success, 'abc123', false)).toEqual({
            needsRun: false,
            skipReason: 'unchanged',
            previousChecksum: 'abc123',
        });

    });

    it('should skip on a matching unchanged-skip row written by older builds', () => {

        const record: ExecutionRecord = { ...success, exec_status: 'skipped', skip_reason: 'unchanged' };

        expect(decideNeedsRun(record, 'abc123', false)).toEqual({
            needsRun: false,
            skipReason: 'unchanged',
            previousChecksum: 'abc123',
        });

    });

    it('should run an unchanged-skip row whose checksum no longer matches', () => {

        const record: ExecutionRecord = { ...success, exec_status: 'skipped', skip_reason: 'unchanged' };

        expect(decideNeedsRun(record, 'def456', false)).toEqual({
            needsRun: true,
            reason: 'changed',
            previousChecksum: 'abc123',
        });

    });

});

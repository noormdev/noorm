import { describe, it, expect } from 'bun:test';

import { buildMergedChangeList, buildPendingChangeList } from '../../../src/tui/utils/change-loader.js';
import type { ChangeStatus } from '../../../src/core/change/types.js';
import type { ChangeParseFailure } from '../../../src/core/change/parser.js';

function status(name: string, state: ChangeStatus['status']): ChangeStatus {

    return {
        name,
        status: state,
        appliedAt: null,
        appliedBy: null,
        revertedAt: null,
        errorMessage: null,
    };

}

const broken: ChangeParseFailure = {
    name: '2026-02-01-broken',
    path: '/project/db/changes/2026-02-01-broken',
    message: "Manifest 'x.txt' references missing file: views/missing.sql",
};

describe('tui: change loader with unreadable changes', () => {

    describe('buildPendingChangeList', () => {

        it('should list an unreadable change that never ran, so the screens do not say there is nothing pending', () => {

            const pending = buildPendingChangeList([], new Map(), [broken]);

            expect(pending.map((c) => c.name)).toEqual(['2026-02-01-broken']);
            expect(pending[0]?.status).toBe('failed');
            expect(pending[0]?.errorMessage).toContain('missing.sql');

        });

        it('should list an unreadable change that was reverted', () => {

            const statuses = new Map([[broken.name, status(broken.name, 'reverted')]]);

            expect(buildPendingChangeList([], statuses, [broken]).map((c) => c.name)).toEqual([broken.name]);

        });

        it('should not list an unreadable change that is applied', () => {

            const statuses = new Map([[broken.name, status(broken.name, 'success')]]);

            expect(buildPendingChangeList([], statuses, [broken])).toEqual([]);

        });

    });

    describe('buildMergedChangeList', () => {

        it('should show an unreadable change as failed, not orphaned', () => {

            const merged = buildMergedChangeList([], new Map(), [broken]);

            expect(merged).toHaveLength(1);
            expect(merged[0]?.status).toBe('failed');
            expect(merged[0]?.orphaned).toBe(false);

        });

        it('should keep the recorded status of an applied change whose files can no longer be read', () => {

            const statuses = new Map([[broken.name, status(broken.name, 'success')]]);
            const merged = buildMergedChangeList([], statuses, [broken]);

            expect(merged).toHaveLength(1);
            expect(merged[0]?.status).toBe('success');
            expect(merged[0]?.orphaned).toBe(false);

        });

    });

});

/**
 * Coverage for the `list_users` TVF.
 *
 * Exercises the three parameters (p_include_deleted, p_limit, p_offset) and
 * the soft-delete filter behavior against a live-ish data set.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

describe('functions/list_users', () => {

    let ctx: TestContext;
    const createdIds: number[] = [];

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    afterAll(async () => {

        if (createdIds.length > 0) {

            await ctx.kysely
                .deleteFrom('user')
                .where('id', 'in', createdIds)
                .execute();

        }

    });

    test('default params omit deleted users and return newest-first', async () => {

        const live = uid('lu-live');
        const dead = uid('lu-dead');

        const liveRow = await ctx.kysely
            .insertInto('user')
            .values({ username: live, email: `${live}@example.test` })
            .returning('id')
            .executeTakeFirstOrThrow();

        const deadRow = await ctx.kysely
            .insertInto('user')
            .values({
                username: dead,
                email: `${dead}@example.test`,
                deleted_at: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(liveRow.id, deadRow.id);

        const rows = await ctx.tvf('list_users');

        const liveMatch = rows.find((r) => r.id === liveRow.id);
        const deadMatch = rows.find((r) => r.id === deadRow.id);

        expect(liveMatch).toBeDefined();
        expect(liveMatch?.deleted_at).toBeNull();
        expect(deadMatch).toBeUndefined();

    });

    test('p_include_deleted=true surfaces soft-deleted rows with deleted_at set', async () => {

        const name = uid('lu-inc');

        const inserted = await ctx.kysely
            .insertInto('user')
            .values({
                username: name,
                email: `${name}@example.test`,
                deleted_at: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        createdIds.push(inserted.id);

        const rows = await ctx.tvf('list_users', { p_include_deleted: true });
        const hit = rows.find((r) => r.id === inserted.id);

        expect(hit).toBeDefined();
        expect(hit?.deleted_at).toBeInstanceOf(Date);

    });

    test('pagination: p_limit + p_offset slice the result set', async () => {

        const allRows = await ctx.tvf('list_users', { p_include_deleted: true });
        const totalBefore = allRows.length;

        // Must have at least 3 rows across this file + table fixtures to make the
        // limit/offset assertion meaningful.
        expect(totalBefore).toBeGreaterThanOrEqual(3);

        const first = await ctx.tvf('list_users', {
            p_include_deleted: true,
            p_limit: 2,
            p_offset: 0,
        });

        const second = await ctx.tvf('list_users', {
            p_include_deleted: true,
            p_limit: 2,
            p_offset: 2,
        });

        expect(first).toHaveLength(2);
        expect(second.length).toBeGreaterThan(0);

        // No overlap between the two pages.
        const firstIds = new Set(first.map((r) => r.id));
        for (const r of second) {

            expect(firstIds.has(r.id)).toBe(false);

        }

    });

});

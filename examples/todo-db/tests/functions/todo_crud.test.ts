/**
 * Round-trip coverage for the todo CRUD TVFs:
 *   create_todo → get_todo → update_todo → list_todos_by_user/category → delete_todo
 *
 * Every TVF is called through `ctx.tvf` / `ctx.func` so the generated SQL and
 * parameter binding live in the SDK, not the test. delete_todo is scalar-
 * returning (RETURNS BOOLEAN) and therefore dispatched via `ctx.func`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface Owner {
    userId: number;
    categoryId: number;
}

async function seedOwner(ctx: TestContext, prefix: string): Promise<Owner> {

    const username = uid(prefix);
    const categoryName = uid(`${prefix}-cat`);

    const user = await ctx.kysely
        .insertInto('user')
        .values({ username, email: `${username}@example.test` })
        .returning('id')
        .executeTakeFirstOrThrow();

    const category = await ctx.kysely
        .insertInto('category')
        .values({ name: categoryName })
        .returning('id')
        .executeTakeFirstOrThrow();

    return { userId: user.id, categoryId: category.id };

}

describe('functions/todo CRUD via TVFs + func', () => {

    let ctx: TestContext;
    const userCleanup: number[] = [];
    const categoryCleanup: number[] = [];

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    afterAll(async () => {

        if (userCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('user')
                .where('id', 'in', userCleanup)
                .execute();

        }

        if (categoryCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('category')
                .where('id', 'in', categoryCleanup)
                .execute();

        }

    });

    test('create_todo returns a single-row result set with defaults applied', async () => {

        const owner = await seedOwner(ctx, 'tc-create');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const rows = await ctx.tvf('create_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_title: 'ship it',
        });

        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.title).toBe('ship it');
        expect(row.status).toBe('pending');
        expect(row.priority).toBe(0);
        expect(row.metadata).toEqual({});
        expect(row.created_at).toBeInstanceOf(Date);

    });

    test('get_todo echoes the just-created row', async () => {

        const owner = await seedOwner(ctx, 'tc-get');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        // create_todo uses DEFAULT CURRENT_TIMESTAMP which has microsecond
        // precision in Postgres. JS Date is millisecond-precision, so when we
        // round-trip the returned Date back as `p_created_at` the `=`
        // comparison fails on truncated microseconds. Insert via kysely with
        // an explicit Date so the stored value matches what we query with.
        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'fetch me',
                priority: 2,
                metadata: { origin: 'kysely' },
            })
            .execute();

        const rows = await ctx.tvf('get_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: createdAt,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.title).toBe('fetch me');
        expect(rows[0]!.priority).toBe(2);
        expect(rows[0]!.metadata).toEqual({ origin: 'kysely' });

    });

    test('update_todo mutates status + priority + metadata', async () => {

        const owner = await seedOwner(ctx, 'tc-update');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        // Insert via kysely with an explicit Date — see get_todo test for why
        // create_todo's DEFAULT CURRENT_TIMESTAMP breaks round-trip equality.
        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'mutable',
            })
            .execute();

        const [updated] = await ctx.tvf('update_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: createdAt,
            p_title: 'mutated',
            p_description: 'after update',
            p_status: 'in_progress',
            p_priority: 3,
            p_metadata: { v: 2 },
        });

        expect(updated).toBeDefined();
        expect(updated!.title).toBe('mutated');
        expect(updated!.description).toBe('after update');
        expect(updated!.status).toBe('in_progress');
        expect(updated!.priority).toBe(3);
        expect(updated!.metadata).toEqual({ v: 2 });

    });

    test('list_todos_by_user returns rows only for that user, sorted by priority', async () => {

        const owner = await seedOwner(ctx, 'tc-list-user');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const other = await seedOwner(ctx, 'tc-list-other');
        userCleanup.push(other.userId);
        categoryCleanup.push(other.categoryId);

        await ctx.tvf('create_todo', { p_user_id: owner.userId, p_category_id: owner.categoryId, p_title: 'low', p_priority: 1 });
        await ctx.tvf('create_todo', { p_user_id: owner.userId, p_category_id: owner.categoryId, p_title: 'high', p_priority: 5 });
        await ctx.tvf('create_todo', { p_user_id: other.userId, p_category_id: other.categoryId, p_title: 'other', p_priority: 5 });

        const rows = await ctx.tvf('list_todos_by_user', { p_user_id: owner.userId });

        expect(rows.every((r) => r.user_id === owner.userId)).toBe(true);
        expect(rows.map((r) => r.title).slice(0, 2)).toEqual(['high', 'low']);

    });

    test('list_todos_by_category filters by category id', async () => {

        const owner = await seedOwner(ctx, 'tc-list-cat');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        await ctx.tvf('create_todo', { p_user_id: owner.userId, p_category_id: owner.categoryId, p_title: 'cat-a' });
        await ctx.tvf('create_todo', { p_user_id: owner.userId, p_category_id: owner.categoryId, p_title: 'cat-b' });

        const rows = await ctx.tvf('list_todos_by_category', {
            p_category_id: owner.categoryId,
        });

        expect(rows.every((r) => r.category_id === owner.categoryId)).toBe(true);
        expect(rows.length).toBeGreaterThanOrEqual(2);

    });

    test('delete_todo returns true when the row existed and false otherwise', async () => {

        const owner = await seedOwner(ctx, 'tc-delete');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'temporary',
            })
            .execute();

        // ctx.func returns the full aliased row — SELECT delete_todo(...) AS
        // delete_todo gives `{ delete_todo: boolean }`. The declared Funcs
        // tuple types this as the row shape.
        const deleted = await ctx.func(
            'delete_todo',
            { p_user_id: owner.userId, p_category_id: owner.categoryId, p_created_at: createdAt },
            'delete_todo',
        );

        expect(deleted.delete_todo).toBe(true);

        const missing = await ctx.func(
            'delete_todo',
            { p_user_id: owner.userId, p_category_id: owner.categoryId, p_created_at: createdAt },
            'delete_todo',
        );

        expect(missing.delete_todo).toBe(false);

    });

});

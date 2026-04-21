/**
 * Transactional coverage for `complete_todo`.
 *
 * The function guarantees:
 *   - Flips todo.status → 'completed'
 *   - Flips every un-completed todo_item to is_completed = TRUE
 *   - Returns the new status + the exact count of items it had to flip
 *   - Raises on missing todos (P0002) and already-completed ones (P0001)
 *
 * The test exercises all four paths, including the "mixed items" case where
 * only some items needed flipping so `items_completed` can be verified.
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

describe('functions/complete_todo — transactional SP', () => {

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

    test('flips todo + all un-completed items, counts only the flipped ones', async () => {

        const owner = await seedOwner(ctx, 'ct-mixed');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'release checklist',
            })
            .execute();

        await ctx.kysely
            .insertInto('todo_item')
            .values([
                { user_id: owner.userId, category_id: owner.categoryId, todo_created_at: createdAt, item_index: 1, title: 'already done', is_completed: true },
                { user_id: owner.userId, category_id: owner.categoryId, todo_created_at: createdAt, item_index: 2, title: 'pending 1', is_completed: false },
                { user_id: owner.userId, category_id: owner.categoryId, todo_created_at: createdAt, item_index: 3, title: 'pending 2', is_completed: false },
            ])
            .execute();

        const [result] = await ctx.tvf('complete_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: createdAt,
        });

        expect(result).toBeDefined();
        expect(result!.status).toBe('completed');
        expect(result!.items_completed).toBe(2);

        const todo = await ctx.kysely
            .selectFrom('todo')
            .select('status')
            .where('user_id', '=', owner.userId)
            .where('category_id', '=', owner.categoryId)
            .where('created_at', '=', createdAt)
            .executeTakeFirstOrThrow();

        expect(todo.status).toBe('completed');

        const items = await ctx.kysely
            .selectFrom('todo_item')
            .select(['item_index', 'is_completed'])
            .where('user_id', '=', owner.userId)
            .where('category_id', '=', owner.categoryId)
            .where('todo_created_at', '=', createdAt)
            .orderBy('item_index', 'asc')
            .execute();

        expect(items.every((i) => i.is_completed)).toBe(true);

    });

    test('raises when the todo is missing', async () => {

        const owner = await seedOwner(ctx, 'ct-missing');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const call = ctx.tvf('complete_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: new Date('2000-01-01T00:00:00Z'),
        });

        await expect(call).rejects.toThrow(/todo not found/i);

    });

    test('raises when the todo is already completed', async () => {

        const owner = await seedOwner(ctx, 'ct-double');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'one-shot',
            })
            .execute();

        await ctx.tvf('complete_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: createdAt,
        });

        const second = ctx.tvf('complete_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: createdAt,
        });

        await expect(second).rejects.toThrow(/already completed/i);

    });

    test('items_completed is 0 when there are no items to flip', async () => {

        const owner = await seedOwner(ctx, 'ct-empty');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: 'childless',
            })
            .execute();

        const [result] = await ctx.tvf('complete_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_created_at: createdAt,
        });

        expect(result!.items_completed).toBe(0);
        expect(result!.status).toBe('completed');

    });

});

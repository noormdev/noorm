/**
 * Happy-path CRUD coverage for the `todo` table via Kysely.
 *
 * Composite PK (user_id, category_id, created_at) forces the test to create a
 * parent user + category first, then insert with an explicit created_at so
 * subsequent rows don't collide on CURRENT_TIMESTAMP resolution.
 *
 * Also covers JSONB round-trip, CHECK(status) and CHECK(priority) enforcement,
 * and FK ON DELETE CASCADE from the user side.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface Ownership {
    userId: number;
    categoryId: number;
    cleanupCategories: number[];
}

async function seedOwners(ctx: TestContext, prefix: string): Promise<Ownership> {

    const username = uid(prefix);
    const email = `${username}@example.test`;
    const categoryName = uid(`${prefix}-cat`);

    const user = await ctx.kysely
        .insertInto('user')
        .values({ username, email })
        .returning('id')
        .executeTakeFirstOrThrow();

    const category = await ctx.kysely
        .insertInto('category')
        .values({ name: categoryName })
        .returning('id')
        .executeTakeFirstOrThrow();

    return {
        userId: user.id,
        categoryId: category.id,
        cleanupCategories: [category.id],
    };

}

describe('tables/todo — CRUD via Kysely', () => {

    let ctx: TestContext;

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    const userCleanup: number[] = [];
    const categoryCleanup: number[] = [];

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

    test('insert: round-trips a todo with defaults and JSONB metadata', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-default');
        userCleanup.push(userId);
        categoryCleanup.push(categoryId);

        const createdAt = new Date();

        const metadata = { source: 'test', labels: ['alpha', 'beta'], retries: 0 };

        const inserted = await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: createdAt,
                title: 'buy milk',
                metadata,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(inserted.title).toBe('buy milk');
        expect(inserted.status).toBe('pending');
        expect(inserted.priority).toBe(0);
        expect(inserted.metadata).toEqual(metadata);
        expect(inserted.created_at).toBeInstanceOf(Date);
        expect(inserted.updated_at).toBeInstanceOf(Date);

    });

    test('select: fetches by composite primary key', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-select');
        userCleanup.push(userId);
        categoryCleanup.push(categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: createdAt,
                title: 'read book',
                priority: 3,
            })
            .execute();

        const row = await ctx.kysely
            .selectFrom('todo')
            .selectAll()
            .where('user_id', '=', userId)
            .where('category_id', '=', categoryId)
            .where('created_at', '=', createdAt)
            .executeTakeFirstOrThrow();

        expect(row.title).toBe('read book');
        expect(row.priority).toBe(3);

    });

    test('update: bumps status + priority + metadata merge', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-update');
        userCleanup.push(userId);
        categoryCleanup.push(categoryId);

        const createdAt = new Date();

        const inserted = await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: createdAt,
                title: 'walk dog',
                metadata: { pet: 'rex' },
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        await new Promise((resolve) => setTimeout(resolve, 10));

        const updated = await ctx.kysely
            .updateTable('todo')
            .set({
                status: 'in_progress',
                priority: 2,
                metadata: { pet: 'rex', last_walked: '2026-04-19' },
                updated_at: new Date(),
            })
            .where('user_id', '=', userId)
            .where('category_id', '=', categoryId)
            .where('created_at', '=', createdAt)
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(updated.status).toBe('in_progress');
        expect(updated.priority).toBe(2);
        expect(updated.metadata).toEqual({ pet: 'rex', last_walked: '2026-04-19' });
        expect(updated.created_at.getTime()).toBe(inserted.created_at.getTime());
        expect(updated.updated_at.getTime()).toBeGreaterThan(inserted.updated_at.getTime());

    });

    test('delete: removes the todo; subsequent select returns nothing', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-delete');
        userCleanup.push(userId);
        categoryCleanup.push(categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: createdAt,
                title: 'tmp',
            })
            .execute();

        const result = await ctx.kysely
            .deleteFrom('todo')
            .where('user_id', '=', userId)
            .where('category_id', '=', categoryId)
            .where('created_at', '=', createdAt)
            .executeTakeFirst();

        expect(Number(result.numDeletedRows)).toBe(1);

    });

    test('check constraint: invalid status rejected', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-bad-status');
        userCleanup.push(userId);
        categoryCleanup.push(categoryId);

        const insert = ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: new Date(),
                title: 'oops',
                status: 'archived',
            })
            .execute();

        await expect(insert).rejects.toThrow(/chk_todo_status|check/i);

    });

    test('check constraint: priority out of range rejected', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-bad-prio');
        userCleanup.push(userId);
        categoryCleanup.push(categoryId);

        const insert = ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: new Date(),
                title: 'too hot',
                priority: 42,
            })
            .execute();

        await expect(insert).rejects.toThrow(/chk_todo_priority|check/i);

    });

    test('cascade: deleting parent user removes its todos', async () => {

        const { userId, categoryId } = await seedOwners(ctx, 'todo-cascade');
        categoryCleanup.push(categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: userId,
                category_id: categoryId,
                created_at: createdAt,
                title: 'doomed',
            })
            .execute();

        await ctx.kysely.deleteFrom('user').where('id', '=', userId).execute();

        const leftover = await ctx.kysely
            .selectFrom('todo')
            .select('title')
            .where('user_id', '=', userId)
            .execute();

        expect(leftover).toEqual([]);

    });

});

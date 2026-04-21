/**
 * Read-coverage for the `v_todos_with_details` view.
 *
 * Validates:
 *   - user/category joins project the expected denormalised columns
 *   - `item_count` / `completed_item_count` aggregates honour the parent
 *     todo's composite key
 *   - `tags` aggregates to an ordered array, NULL when the todo has none
 *   - `metadata` round-trips as JSONB
 *
 * These rules describe the view's contract — if any of them break,
 * downstream readers (TUI dashboards, SDK consumers) silently go wrong.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface Parent {
    userId: number;
    username: string;
    categoryId: number;
    categoryName: string;
    createdAt: Date;
}

async function seedTodo(
    ctx: TestContext,
    prefix: string,
    metadata: Record<string, unknown> = {},
): Promise<Parent> {

    const username = uid(prefix);
    const categoryName = uid(`${prefix}-cat`);

    const user = await ctx.kysely
        .insertInto('user')
        .values({ username, email: `${username}@example.test` })
        .returning('id')
        .executeTakeFirstOrThrow();

    const category = await ctx.kysely
        .insertInto('category')
        .values({ name: categoryName, description: 'view fixture' })
        .returning('id')
        .executeTakeFirstOrThrow();

    const createdAt = new Date();

    await ctx.kysely
        .insertInto('todo')
        .values({
            user_id: user.id,
            category_id: category.id,
            created_at: createdAt,
            title: 'detailed todo',
            description: 'view test fixture',
            priority: 4,
            metadata,
        })
        .execute();

    return {
        userId: user.id,
        username,
        categoryId: category.id,
        categoryName,
        createdAt,
    };

}

describe('views/v_todos_with_details', () => {

    let ctx: TestContext;

    beforeAll(async () => {

        ctx = await getSharedContext();

    });

    const userCleanup: number[] = [];
    const categoryCleanup: number[] = [];
    const tagCleanup: number[] = [];

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

        if (tagCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('tag')
                .where('id', 'in', tagCleanup)
                .execute();

        }

    });

    test('denormalises user + category + metadata onto the todo row', async () => {

        const parent = await seedTodo(ctx, 'view-plain', { origin: 'test', priority: 'high' });
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        const row = await ctx.kysely
            .selectFrom('v_todos_with_details')
            .selectAll()
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('created_at', '=', parent.createdAt)
            .executeTakeFirstOrThrow();

        expect(row.title).toBe('detailed todo');
        expect(row.priority).toBe(4);
        expect(row.user_username).toBe(parent.username);
        expect(row.user_email).toBe(`${parent.username}@example.test`);
        expect(row.category_name).toBe(parent.categoryName);
        expect(row.category_description).toBe('view fixture');
        expect(Number(row.item_count)).toBe(0);
        expect(Number(row.completed_item_count)).toBe(0);
        expect(row.tags).toBeNull();
        expect(row.metadata).toEqual({ origin: 'test', priority: 'high' });

    });

    test('item_count / completed_item_count aggregate only this todo', async () => {

        const parent = await seedTodo(ctx, 'view-items');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        await ctx.kysely
            .insertInto('todo_item')
            .values([
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.createdAt, item_index: 1, title: 'one', is_completed: true },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.createdAt, item_index: 2, title: 'two', is_completed: false },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.createdAt, item_index: 3, title: 'three', is_completed: true },
            ])
            .execute();

        const row = await ctx.kysely
            .selectFrom('v_todos_with_details')
            .select(['item_count', 'completed_item_count'])
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('created_at', '=', parent.createdAt)
            .executeTakeFirstOrThrow();

        expect(Number(row.item_count)).toBe(3);
        expect(Number(row.completed_item_count)).toBe(2);

    });

    test('tags aggregate sorted; empty when no associations exist', async () => {

        const parent = await seedTodo(ctx, 'view-tags');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        const tagA = await ctx.kysely
            .insertInto('tag')
            .values({ name: uid('view-zebra') })
            .returning('id')
            .executeTakeFirstOrThrow();

        const tagB = await ctx.kysely
            .insertInto('tag')
            .values({ name: uid('view-alpha') })
            .returning('id')
            .executeTakeFirstOrThrow();

        tagCleanup.push(tagA.id, tagB.id);

        await ctx.kysely
            .insertInto('todo_tag')
            .values([
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.createdAt, tag_id: tagA.id },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.createdAt, tag_id: tagB.id },
            ])
            .execute();

        const row = await ctx.kysely
            .selectFrom('v_todos_with_details')
            .select('tags')
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('created_at', '=', parent.createdAt)
            .executeTakeFirstOrThrow();

        // ARRAY_AGG(... ORDER BY tg.name) sorts alphabetically.
        expect(row.tags).toEqual([...(row.tags ?? [])].sort());
        expect(row.tags).toHaveLength(2);

    });

});

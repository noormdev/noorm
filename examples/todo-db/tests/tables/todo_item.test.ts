/**
 * Happy-path CRUD coverage for the `todo_item` table via Kysely.
 *
 * todo_item inherits the composite PK of its parent todo and adds an
 * `item_index`, giving it a 4-column PK: (user_id, category_id,
 * todo_created_at, item_index). The ON DELETE CASCADE from `todo` means
 * deleting the parent todo removes the children, which is also asserted.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface Parent {
    userId: number;
    categoryId: number;
    todoCreatedAt: Date;
}

async function seedParentTodo(ctx: TestContext, prefix: string): Promise<Parent> {

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

    const todoCreatedAt = new Date();

    await ctx.kysely
        .insertInto('todo')
        .values({
            user_id: user.id,
            category_id: category.id,
            created_at: todoCreatedAt,
            title: 'parent todo',
        })
        .execute();

    return { userId: user.id, categoryId: category.id, todoCreatedAt };

}

describe('tables/todo_item — CRUD via Kysely', () => {

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

    test('insert: round-trips an item under its parent todo', async () => {

        const parent = await seedParentTodo(ctx, 'item-insert');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        const inserted = await ctx.kysely
            .insertInto('todo_item')
            .values({
                user_id: parent.userId,
                category_id: parent.categoryId,
                todo_created_at: parent.todoCreatedAt,
                item_index: 1,
                title: 'step one',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(inserted.title).toBe('step one');
        expect(inserted.is_completed).toBe(false);
        expect(inserted.created_at).toBeInstanceOf(Date);
        expect(inserted.updated_at).toBeInstanceOf(Date);

    });

    test('select: fetches items ordered by item_index', async () => {

        const parent = await seedParentTodo(ctx, 'item-select');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        await ctx.kysely
            .insertInto('todo_item')
            .values([
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 2, title: 'second' },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 1, title: 'first' },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 3, title: 'third' },
            ])
            .execute();

        const rows = await ctx.kysely
            .selectFrom('todo_item')
            .select(['item_index', 'title'])
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('todo_created_at', '=', parent.todoCreatedAt)
            .orderBy('item_index', 'asc')
            .execute();

        expect(rows.map((r) => r.title)).toEqual(['first', 'second', 'third']);

    });

    test('update: toggles is_completed and bumps updated_at', async () => {

        const parent = await seedParentTodo(ctx, 'item-update');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        const inserted = await ctx.kysely
            .insertInto('todo_item')
            .values({
                user_id: parent.userId,
                category_id: parent.categoryId,
                todo_created_at: parent.todoCreatedAt,
                item_index: 1,
                title: 'todo',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        await new Promise((resolve) => setTimeout(resolve, 10));

        const updated = await ctx.kysely
            .updateTable('todo_item')
            .set({ is_completed: true, updated_at: new Date() })
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('todo_created_at', '=', parent.todoCreatedAt)
            .where('item_index', '=', 1)
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(updated.is_completed).toBe(true);
        expect(updated.updated_at.getTime()).toBeGreaterThan(inserted.updated_at.getTime());

    });

    test('delete: removes one item without touching siblings', async () => {

        const parent = await seedParentTodo(ctx, 'item-delete');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        await ctx.kysely
            .insertInto('todo_item')
            .values([
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 1, title: 'keep' },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 2, title: 'drop' },
            ])
            .execute();

        const result = await ctx.kysely
            .deleteFrom('todo_item')
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('todo_created_at', '=', parent.todoCreatedAt)
            .where('item_index', '=', 2)
            .executeTakeFirst();

        expect(Number(result.numDeletedRows)).toBe(1);

        const remaining = await ctx.kysely
            .selectFrom('todo_item')
            .select('title')
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('todo_created_at', '=', parent.todoCreatedAt)
            .execute();

        expect(remaining.map((r) => r.title)).toEqual(['keep']);

    });

    test('check constraint: item_index must be positive', async () => {

        const parent = await seedParentTodo(ctx, 'item-bad-index');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        const insert = ctx.kysely
            .insertInto('todo_item')
            .values({
                user_id: parent.userId,
                category_id: parent.categoryId,
                todo_created_at: parent.todoCreatedAt,
                item_index: 0,
                title: 'zero',
            })
            .execute();

        await expect(insert).rejects.toThrow(/chk_item_index_positive|check/i);

    });

    test('cascade: deleting parent todo wipes its items', async () => {

        const parent = await seedParentTodo(ctx, 'item-cascade');
        userCleanup.push(parent.userId);
        categoryCleanup.push(parent.categoryId);

        await ctx.kysely
            .insertInto('todo_item')
            .values([
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 1, title: 'a' },
                { user_id: parent.userId, category_id: parent.categoryId, todo_created_at: parent.todoCreatedAt, item_index: 2, title: 'b' },
            ])
            .execute();

        await ctx.kysely
            .deleteFrom('todo')
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('created_at', '=', parent.todoCreatedAt)
            .execute();

        const leftover = await ctx.kysely
            .selectFrom('todo_item')
            .select('title')
            .where('user_id', '=', parent.userId)
            .where('category_id', '=', parent.categoryId)
            .where('todo_created_at', '=', parent.todoCreatedAt)
            .execute();

        expect(leftover).toEqual([]);

    });

});

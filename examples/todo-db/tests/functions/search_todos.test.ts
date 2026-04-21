/**
 * Coverage for the `search_todos` TVF.
 *
 * The function joins todo + user + category, applies ILIKE on title/description
 * and an equality filter on status, excludes soft-deleted users, and aggregates
 * tag names into a TEXT[] via COALESCE(ARRAY_AGG, ARRAY[]::TEXT[]). These tests
 * use a unique keyword prefix per run so the searches are scoped to rows we
 * seeded — avoids collisions with whatever else lives in the shared DB.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { TestContext } from '../_helpers/context.js';
import { getSharedContext, uid } from '../_helpers/setup.js';

interface Owner {
    userId: number;
    categoryId: number;
    keyword: string;
}

async function seedOwner(ctx: TestContext, prefix: string): Promise<Owner> {

    const username = uid(prefix);
    const categoryName = uid(`${prefix}-cat`);
    const keyword = uid(`${prefix}-kw`);

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

    return { userId: user.id, categoryId: category.id, keyword };

}

describe('functions/search_todos — TVF over joined todo/user/category', () => {

    let ctx: TestContext;
    const userCleanup: number[] = [];
    const categoryCleanup: number[] = [];
    const tagCleanup: number[] = [];

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

        if (tagCleanup.length > 0) {

            await ctx.kysely
                .deleteFrom('tag')
                .where('id', 'in', tagCleanup)
                .execute();

        }

    });

    test('p_keyword matches title (ILIKE, case-insensitive)', async () => {

        const owner = await seedOwner(ctx, 'st-title');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        await ctx.tvf('create_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_title: `Release ${owner.keyword.toUpperCase()} checklist`,
        });

        await ctx.tvf('create_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_title: 'completely unrelated item',
        });

        const rows = await ctx.tvf('search_todos', {
            p_keyword: owner.keyword,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe(owner.userId);
        expect(rows[0]!.title.toLowerCase()).toContain(owner.keyword.toLowerCase());
        expect(rows[0]!.user_username).toBeDefined();
        expect(rows[0]!.category_name).toBeDefined();
        expect(Array.isArray(rows[0]!.tags)).toBe(true);
        expect(rows[0]!.tags).toEqual([]);

    });

    test('p_keyword matches description', async () => {

        const owner = await seedOwner(ctx, 'st-desc');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        await ctx.tvf('create_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_title: 'title without the token',
            p_description: `long body mentioning ${owner.keyword} once`,
        });

        const rows = await ctx.tvf('search_todos', {
            p_keyword: owner.keyword,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.description).toContain(owner.keyword);

    });

    test('p_status filters by exact status value', async () => {

        const owner = await seedOwner(ctx, 'st-status');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        await ctx.tvf('create_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_title: `${owner.keyword} pending todo`,
        });

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: `${owner.keyword} in-progress todo`,
                status: 'in_progress',
            })
            .execute();

        const pending = await ctx.tvf('search_todos', {
            p_keyword: owner.keyword,
            p_status: 'pending',
        });

        const inProgress = await ctx.tvf('search_todos', {
            p_keyword: owner.keyword,
            p_status: 'in_progress',
        });

        expect(pending).toHaveLength(1);
        expect(pending[0]!.status).toBe('pending');

        expect(inProgress).toHaveLength(1);
        expect(inProgress[0]!.status).toBe('in_progress');

    });

    test('excludes todos owned by soft-deleted users', async () => {

        const owner = await seedOwner(ctx, 'st-softdel');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        await ctx.tvf('create_todo', {
            p_user_id: owner.userId,
            p_category_id: owner.categoryId,
            p_title: `${owner.keyword} will disappear`,
        });

        const before = await ctx.tvf('search_todos', { p_keyword: owner.keyword });
        expect(before).toHaveLength(1);

        await ctx.kysely
            .updateTable('user')
            .set({ deleted_at: new Date() })
            .where('id', '=', owner.userId)
            .execute();

        const after = await ctx.tvf('search_todos', { p_keyword: owner.keyword });
        expect(after).toHaveLength(0);

    });

    test('tags array is populated and sorted when todo_tag rows exist', async () => {

        const owner = await seedOwner(ctx, 'st-tags');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const createdAt = new Date();

        await ctx.kysely
            .insertInto('todo')
            .values({
                user_id: owner.userId,
                category_id: owner.categoryId,
                created_at: createdAt,
                title: `${owner.keyword} tagged`,
            })
            .execute();

        const tagZ = await ctx.kysely
            .insertInto('tag')
            .values({ name: uid('st-tag-z') })
            .returning(['id', 'name'])
            .executeTakeFirstOrThrow();

        const tagA = await ctx.kysely
            .insertInto('tag')
            .values({ name: uid('st-tag-a') })
            .returning(['id', 'name'])
            .executeTakeFirstOrThrow();

        tagCleanup.push(tagZ.id, tagA.id);

        await ctx.kysely
            .insertInto('todo_tag')
            .values([
                { user_id: owner.userId, category_id: owner.categoryId, todo_created_at: createdAt, tag_id: tagZ.id },
                { user_id: owner.userId, category_id: owner.categoryId, todo_created_at: createdAt, tag_id: tagA.id },
            ])
            .execute();

        const rows = await ctx.tvf('search_todos', { p_keyword: owner.keyword });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.tags).toEqual([tagA.name, tagZ.name].sort());

    });

    test('pagination: p_limit caps row count and ordering is created_at DESC', async () => {

        const owner = await seedOwner(ctx, 'st-page');
        userCleanup.push(owner.userId);
        categoryCleanup.push(owner.categoryId);

        const first = new Date(Date.now() - 3000);
        const middle = new Date(Date.now() - 2000);
        const last = new Date(Date.now() - 1000);

        await ctx.kysely
            .insertInto('todo')
            .values([
                { user_id: owner.userId, category_id: owner.categoryId, created_at: first, title: `${owner.keyword} first` },
                { user_id: owner.userId, category_id: owner.categoryId, created_at: middle, title: `${owner.keyword} middle` },
                { user_id: owner.userId, category_id: owner.categoryId, created_at: last, title: `${owner.keyword} last` },
            ])
            .execute();

        const page = await ctx.tvf('search_todos', {
            p_keyword: owner.keyword,
            p_limit: 2,
            p_offset: 0,
        });

        expect(page).toHaveLength(2);
        expect(page[0]!.title.endsWith('last')).toBe(true);
        expect(page[1]!.title.endsWith('middle')).toBe(true);

        const next = await ctx.tvf('search_todos', {
            p_keyword: owner.keyword,
            p_limit: 2,
            p_offset: 2,
        });

        expect(next).toHaveLength(1);
        expect(next[0]!.title.endsWith('first')).toBe(true);

    });

});
